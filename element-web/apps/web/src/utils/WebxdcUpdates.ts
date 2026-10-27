/*
 * Haven: a webxdc game's moves ("updates"), kept in the room as events that reference the game's
 * file event. See webxdc.ts.
 *
 * Moves go out one event at a time. Moves a game makes while one is on its way go together in the
 * next event ("updates", a list, where a lone move is "update"), so a game sending many moves
 * quickly doesn't run into the server's limit on how fast messages can be sent. When it does
 * anyway, the event is sent again once the server says it can be.
 *
 * A move's payload can be any JSON, but events can't hold numbers with a fraction or past 2^53, so
 * it's kept as JSON text ("payload_json"). Moves with a "payload" of their own are read too.
 */

import {
    Direction,
    EventStatus,
    type MatrixClient,
    MatrixError,
    type MatrixEvent,
    type Room,
    RoomEvent,
    RelationType,
    safeGetRetryAfterMs,
} from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { WEBXDC_MAX_UPDATE_SIZE, WEBXDC_UPDATE_EVENT_TYPE } from "./webxdc";

/** An update as a game receives it. */
export interface WebxdcUpdate {
    payload: unknown;
    info?: string;
    summary?: string;
    document?: string;
    href?: string;
    serial: number;
    max_serial: number;
}

type StoredUpdate = Omit<WebxdcUpdate, "max_serial">;

/** Fields of an update a game sends that are kept (the spec's, less those Haven doesn't act on). */
const TEXT_FIELDS = ["info", "summary", "document", "href"] as const;

/** Pages of history read when a game starts, 100 moves each. */
const MAX_HISTORY_PAGES = 50;
/** How many times an event the server turned away for coming too fast is tried again. */
const MAX_RATE_LIMIT_RETRIES = 20;
/** How long to wait before trying again, when the server doesn't say. */
const DEFAULT_RETRY_MS = 5000;

/** A move waiting to go out. */
interface Outgoing {
    update: Record<string, unknown>;
    size: number;
    description: string;
    sent: () => void;
    failed: (error: unknown) => void;
}

export class WebxdcUpdateTooLargeError extends Error {}

export class WebxdcUpdates {
    private readonly updates: StoredUpdate[] = [];
    private readonly seen = new Set<string>();
    private readonly listeners = new Set<(updates: WebxdcUpdate[]) => void>();
    private loaded = false;
    private stopped = false;
    private buffered: MatrixEvent[] = [];
    private outgoing: Outgoing[] = [];
    private sending = false;

    public constructor(
        private readonly client: MatrixClient,
        private readonly roomId: string,
        private readonly gameEventId: string,
    ) {}

    /** Read the moves so far, and follow new ones until stop(). */
    public async start(): Promise<void> {
        this.client.on(RoomEvent.Timeline, this.onTimeline);
        this.client.on(RoomEvent.LocalEchoUpdated, this.onLocalEchoUpdated);

        const history: MatrixEvent[] = [];
        let from: string | undefined;
        try {
            for (let page = 0; page < MAX_HISTORY_PAGES && !this.stopped; page++) {
                const result = await this.client.relations(
                    this.roomId,
                    this.gameEventId,
                    RelationType.Reference,
                    WEBXDC_UPDATE_EVENT_TYPE,
                    { dir: Direction.Backward, limit: 100, from },
                );
                history.push(...result.events);
                from = result.nextBatch ?? undefined;
                if (!from) break;
            }
        } catch (e) {
            logger.warn("webxdc: could not read the game's moves", e);
        }

        history.reverse();
        for (const event of history) this.add(event);
        this.loaded = true;
        const buffered = this.buffered;
        this.buffered = [];
        this.deliver(buffered.flatMap((event) => this.add(event)));
    }

    public stop(): void {
        this.stopped = true;
        this.client.off(RoomEvent.Timeline, this.onTimeline);
        this.client.off(RoomEvent.LocalEchoUpdated, this.onLocalEchoUpdated);
        this.listeners.clear();
    }

    public get maxSerial(): number {
        return this.updates.length;
    }

    /** Updates after `serial`, as a game receives them. */
    public since(serial: number): WebxdcUpdate[] {
        const maxSerial = this.maxSerial;
        return this.updates.slice(Math.max(0, serial)).map((update) => ({ ...update, max_serial: maxSerial }));
    }

    /** Be told of new updates, after start() has read the history. */
    public onUpdates(listener: (updates: WebxdcUpdate[]) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * Send a move. It reaches the game, like everyone else's, once the server has it. Resolves once
     * it's sent; moves are sent in the order they're made, even after this stops.
     */
    public send(update: unknown, description: string): Promise<void> {
        if (!update || typeof update !== "object" || !("payload" in update)) return Promise.resolve();
        const source = update as Record<string, unknown>;
        const kept: Record<string, unknown> = { payload_json: JSON.stringify(source.payload ?? null) };
        for (const field of TEXT_FIELDS) {
            if (typeof source[field] === "string") kept[field] = source[field];
        }
        const size = new TextEncoder().encode(JSON.stringify(kept)).length;
        if (size > WEBXDC_MAX_UPDATE_SIZE) return Promise.reject(new WebxdcUpdateTooLargeError());
        return new Promise((sent, failed) => {
            this.outgoing.push({ update: kept, size, description, sent, failed });
            void this.sendOutgoing();
        });
    }

    /** Sends the waiting moves, as many to an event as fit, one event at a time. */
    private async sendOutgoing(): Promise<void> {
        if (this.sending) return;
        this.sending = true;
        try {
            while (this.outgoing.length) {
                let size = 0;
                let count = 0;
                while (
                    count < this.outgoing.length &&
                    (count === 0 || size + this.outgoing[count].size <= WEBXDC_MAX_UPDATE_SIZE)
                ) {
                    size += this.outgoing[count].size;
                    count++;
                }
                const batch = this.outgoing.splice(0, count);
                try {
                    await this.sendEvent(batch);
                    for (const move of batch) move.sent();
                } catch (e) {
                    for (const move of batch) move.failed(e);
                }
            }
        } finally {
            this.sending = false;
        }
    }

    private async sendEvent(batch: Outgoing[]): Promise<void> {
        // The latest move's description that has one.
        const description = batch
            .map((move) => move.description)
            .reverse()
            .find(Boolean);
        const content = {
            "m.relates_to": {
                rel_type: RelationType.Reference,
                event_id: this.gameEventId,
            },
            ...(batch.length === 1 ? { update: batch[0].update } : { updates: batch.map((move) => move.update) }),
            "body": (description ?? "").slice(0, 200),
        };
        for (let attempt = 0; ; attempt++) {
            try {
                await this.client.sendEvent(this.roomId, WEBXDC_UPDATE_EVENT_TYPE as any, content);
                return;
            } catch (e) {
                if (!(e instanceof MatrixError) || !e.isRateLimitError() || attempt >= MAX_RATE_LIMIT_RETRIES) throw e;
                // Not left in the room as a message that failed: it's sent again in a moment.
                if (e.event) this.client.cancelPendingEvent(e.event);
                await new Promise((resolve) => setTimeout(resolve, safeGetRetryAfterMs(e, DEFAULT_RETRY_MS)));
            }
        }
    }

    private readonly onTimeline = (
        event: MatrixEvent,
        room: Room | undefined,
        toStartOfTimeline: boolean | undefined,
    ): void => {
        if (room?.roomId !== this.roomId || toStartOfTimeline) return;
        void this.consider(event);
    };

    private readonly onLocalEchoUpdated = (event: MatrixEvent, room: Room): void => {
        if (room.roomId !== this.roomId) return;
        void this.consider(event);
    };

    private async consider(event: MatrixEvent): Promise<void> {
        const relation = event.getRelation();
        if (relation?.rel_type !== RelationType.Reference || relation.event_id !== this.gameEventId) return;
        await this.client.decryptEventIfNeeded(event);
        if (this.stopped || event.getType() !== WEBXDC_UPDATE_EVENT_TYPE) return;
        if (!this.loaded) {
            this.buffered.push(event);
            return;
        }
        this.deliver(this.add(event));
    }

    /** Keep an event's updates, unless they're already kept or not yet on the server. */
    private add(event: MatrixEvent): StoredUpdate[] {
        if (event.status !== null && event.status !== EventStatus.SENT) return [];
        const id = event.getId();
        if (!id || id.startsWith("~") || this.seen.has(id) || event.isRedacted()) return [];
        const content = event.getContent();
        const updates: unknown[] = Array.isArray(content.updates) ? content.updates : [content.update];
        this.seen.add(id);
        const kept: StoredUpdate[] = [];
        for (const update of updates) {
            if (!update || typeof update !== "object") continue;
            const fields = update as Record<string, unknown>;
            let payload: unknown;
            if (typeof fields.payload_json === "string") {
                try {
                    payload = JSON.parse(fields.payload_json);
                } catch {
                    continue;
                }
            } else if ("payload" in fields) {
                payload = fields.payload;
            } else {
                continue;
            }
            const stored: StoredUpdate = {
                payload,
                serial: this.updates.length + 1,
            };
            for (const field of TEXT_FIELDS) {
                if (typeof fields[field] === "string") stored[field] = fields[field];
            }
            this.updates.push(stored);
            kept.push(stored);
        }
        return kept;
    }

    private deliver(updates: StoredUpdate[]): void {
        if (!updates.length) return;
        const maxSerial = this.maxSerial;
        const delivered = updates.map((update) => ({
            ...update,
            max_serial: maxSerial,
        }));
        for (const listener of this.listeners) listener(delivered);
    }
}

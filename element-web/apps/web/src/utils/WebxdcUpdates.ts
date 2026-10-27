/*
 * Haven: a webxdc game's moves ("updates"), kept in the room as events that reference the game's
 * file event. See webxdc.ts.
 */

import {
    Direction,
    EventStatus,
    type MatrixClient,
    type MatrixEvent,
    type Room,
    RoomEvent,
    RelationType,
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

export class WebxdcUpdateTooLargeError extends Error {}

export class WebxdcUpdates {
    private readonly updates: StoredUpdate[] = [];
    private readonly seen = new Set<string>();
    private readonly listeners = new Set<(updates: WebxdcUpdate[]) => void>();
    private loaded = false;
    private stopped = false;
    private buffered: MatrixEvent[] = [];

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
        this.deliver(buffered.map((event) => this.add(event)).filter((u): u is StoredUpdate => !!u));
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

    /** Send a move. It reaches the game, like everyone else's, once the server has it. */
    public async send(update: unknown, description: string): Promise<void> {
        if (!update || typeof update !== "object" || !("payload" in update)) return;
        const source = update as Record<string, unknown>;
        const kept: Record<string, unknown> = { payload: source.payload };
        for (const field of TEXT_FIELDS) {
            if (typeof source[field] === "string") kept[field] = source[field];
        }
        if (new TextEncoder().encode(JSON.stringify(kept)).length > WEBXDC_MAX_UPDATE_SIZE) {
            throw new WebxdcUpdateTooLargeError();
        }
        await this.client.sendEvent(this.roomId, WEBXDC_UPDATE_EVENT_TYPE as any, {
            "m.relates_to": {
                rel_type: RelationType.Reference,
                event_id: this.gameEventId,
            },
            "update": kept,
            "body": description.slice(0, 200),
        });
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
        const update = this.add(event);
        if (update) this.deliver([update]);
    }

    /** Keep an update, unless it's already kept or not yet on the server. */
    private add(event: MatrixEvent): StoredUpdate | undefined {
        if (event.status !== null && event.status !== EventStatus.SENT) return undefined;
        const id = event.getId();
        if (!id || id.startsWith("~") || this.seen.has(id) || event.isRedacted()) return undefined;
        const update = event.getContent().update;
        if (!update || typeof update !== "object" || !("payload" in update)) return undefined;
        this.seen.add(id);
        const stored: StoredUpdate = {
            payload: update.payload,
            serial: this.updates.length + 1,
        };
        for (const field of TEXT_FIELDS) {
            if (typeof update[field] === "string") stored[field] = update[field];
        }
        this.updates.push(stored);
        return stored;
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

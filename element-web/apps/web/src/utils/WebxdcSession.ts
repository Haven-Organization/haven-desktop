/*
 * Haven: one run of a webxdc game - Haven's side of the conversation with its sandbox frame (see
 * res/webxdc-sandbox/). It hands the sandbox the game's files, passes moves both ways, and stops
 * the game if its frame is sent outside the sandbox.
 *
 * It lives apart from any component, so a game popped out into its own window keeps running while
 * the timeline it came from is gone (see WebxdcPopoutStore).
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import {
    cleanWebxdcSave,
    loadWebxdcSave,
    newWebxdcToken,
    storeWebxdcSave,
    type WebxdcArchive,
    WEBXDC_MAX_UPDATE_SIZE,
    type WebxdcSave,
    type WebxdcSandbox,
} from "./webxdc";
import { WebxdcUpdates, WebxdcUpdateTooLargeError } from "./WebxdcUpdates";
import { WebxdcRealtime, WEBXDC_REALTIME_MAX_SIZE } from "./WebxdcRealtime";

/** How long a page in the frame has to say it's the game's own, after it loads. */
const PAGE_CHECK_MS = 3000;
/** How long the sandbox has to start (its service worker installs the first time). */
const SANDBOX_START_MS = 30_000;
/** How long the game's page has to hand over its save when asked. */
const FLUSH_MS = 1500;

export type WebxdcSessionProblem =
    /** The sandbox didn't start, or said why it couldn't. */
    | { kind: "failed"; message?: string }
    /** The frame was sent to a page outside the sandbox. */
    | { kind: "left_sandbox" }
    /**
     * The game tried something the bundled sandbox can't give it, and needs haven.webxdc_sandbox_url:
     * going to another of its pages, or IndexedDB in a build without the sandbox's own (idb.js).
     */
    | { kind: "needs_sandbox"; what: WebxdcSandboxNeed };

/** What a game needed that only a configured sandbox has. */
export type WebxdcSandboxNeed = "indexeddb" | "pages" | "other";

export interface WebxdcSessionOptions {
    client: MatrixClient;
    roomId: string;
    eventId: string;
    archive: WebxdcArchive;
    sandbox: WebxdcSandbox;
    /** Posts a message to the game's frame. */
    post: (message: unknown, targetOrigin: string) => void;
    /** The game can't go on. */
    onProblem: (problem: WebxdcSessionProblem) => void;
    /** A move couldn't be saved in the room. */
    onSendFailed: () => void;
}

export class WebxdcSession {
    /**
     * Saves on their way to the server, by save key. A run of the game that's starting waits for
     * the one before it to be saved, such as when it's popped out or back in.
     */
    private static readonly saving = new Map<string, Promise<unknown>>();

    public readonly token = newWebxdcToken();
    /** The URL the game's frame loads. */
    public readonly src: string;
    public readonly origin: string;

    private readonly updates: WebxdcUpdates;
    private readonly started: Promise<void>;
    private unsubscribe?: () => void;
    /** The player's save, read once for every time the sandbox asks for the files. */
    private save?: Promise<WebxdcSave | null>;
    /** Whether the last save sent was kept. */
    private stored: Promise<boolean> = Promise.resolve(true);
    private readonly flushes = new Map<number, () => void>();
    private nextFlush = 1;
    private leaveRealtime?: () => void;
    private gameOpened = false;
    /** A page of the game said it's being left; the frame's next page has to say it's the game's. */
    private pageLeft = false;
    private pageSeen = false;
    private pageCheck?: ReturnType<typeof setTimeout>;
    private readonly startCheck: ReturnType<typeof setTimeout>;
    private stopped = false;

    public constructor(private readonly options: WebxdcSessionOptions) {
        this.origin = options.sandbox.origin;
        this.src = `${options.sandbox.page}#t=${this.token}&o=${encodeURIComponent(window.location.origin)}`;
        this.updates = new WebxdcUpdates(options.client, options.roomId, options.eventId);
        this.started = this.updates.start();
        this.startCheck = setTimeout(() => this.problem({ kind: "failed" }), SANDBOX_START_MS);
    }

    /**
     * Asks the game's page for what it hasn't saved yet. Resolves once it has handed it over (or
     * didn't answer), so the page can be closed; the save goes on to the server after that.
     */
    public flush(): Promise<void> {
        if (this.stopped || !this.gameOpened) return Promise.resolve();
        const id = this.nextFlush++;
        const flushed = new Promise<void>((resolve) => {
            const timer = setTimeout(done, FLUSH_MS);
            const flushes = this.flushes;
            function done(): void {
                clearTimeout(timer);
                flushes.delete(id);
                resolve();
            }
            flushes.set(id, done);
        });
        this.post({ type: "xdc.flush", id });
        this.track(flushed.then(() => this.stored));
        return flushed;
    }

    /** Saves the game now: resolves with whether the save was kept. */
    public async saveNow(): Promise<boolean> {
        if (this.stopped || !this.gameOpened) return false;
        await this.flush();
        return this.stored;
    }

    private track(saving: Promise<unknown>): void {
        const key = this.options.archive.saveKey;
        WebxdcSession.saving.set(key, saving);
        void saving.finally(() => {
            if (WebxdcSession.saving.get(key) === saving) WebxdcSession.saving.delete(key);
        });
    }

    public stop(): void {
        this.stopped = true;
        for (const done of this.flushes.values()) done();
        clearTimeout(this.startCheck);
        clearTimeout(this.pageCheck);
        this.unsubscribe?.();
        this.leaveRealtime?.();
        this.leaveRealtime = undefined;
        this.updates.stop();
    }

    /**
     * A message from the game's frame. The caller checks it came from that frame; this checks it's
     * for this run of the game. Returns whether it was.
     */
    public handleMessage(data: unknown): boolean {
        if (this.stopped || !data || typeof data !== "object") return false;
        const message = data as Record<string, unknown>;
        if (message.token !== this.token) return false;
        void this.handle(message);
        return true;
    }

    /**
     * The game's frame loaded a page. Every page of the game says when it's being left, and the
     * next one says it's the game's as it starts; a page that doesn't is one the game sent its frame
     * to, outside the sandbox. Loads without a page being left first are the sandbox's own: its
     * loader opening the game, or (in Firefox) the bundled one writing the game's page.
     */
    public frameLoaded(): void {
        if (this.stopped || !this.gameOpened || !this.pageLeft) return;
        this.pageLeft = false;
        clearTimeout(this.pageCheck);
        if (this.pageSeen) return;
        this.pageCheck = setTimeout(() => {
            if (!this.pageSeen) this.problem({ kind: "left_sandbox" });
        }, PAGE_CHECK_MS);
    }

    /**
     * The bundled sandbox's frame has an origin of its own, which messages can't be addressed to,
     * so they go to whatever page is in the frame. That's only ever what the game itself is given,
     * and a page outside the sandbox is caught by frameLoaded() and the game stopped.
     */
    private post(message: Record<string, unknown>): void {
        const targetOrigin = this.options.sandbox.bundled ? "*" : this.origin;
        if (!this.stopped) this.options.post({ ...message, token: this.token }, targetOrigin);
    }

    private problem(problem: WebxdcSessionProblem): void {
        if (this.stopped) return;
        this.stop();
        this.options.onProblem(problem);
    }

    private async handle(message: Record<string, unknown>): Promise<void> {
        const { client, roomId, archive } = this.options;
        switch (message.type) {
            case "xdc.ready": {
                clearTimeout(this.startCheck);
                this.gameOpened = true;
                const userId = client.getSafeUserId();
                const before = WebxdcSession.saving.get(archive.saveKey);
                this.save ??= Promise.resolve(before)
                    .then(() => loadWebxdcSave(client, archive.saveKey))
                    .catch((e) => {
                        logger.warn("webxdc: could not read the game's save", e);
                        return null;
                    });
                const save = await this.save;
                this.post({
                    type: "xdc.files",
                    files: archive.files,
                    meta: {
                        selfAddr: userId,
                        selfName: client.getRoom(roomId)?.getMember(userId)?.name ?? userId,
                        maxSize: WEBXDC_MAX_UPDATE_SIZE,
                        realtimeMaxSize: WEBXDC_REALTIME_MAX_SIZE,
                        saveKey: archive.saveKey,
                        save: save?.data ?? null,
                        saveUpdated: save?.updated ?? 0,
                    },
                });
                return;
            }
            case "xdc.page":
                this.pageSeen = true;
                return;
            case "xdc.leaving":
                this.pageLeft = true;
                this.pageSeen = false;
                return;
            case "xdc.limit":
                if (!this.options.sandbox.bundled) return;
                this.problem({
                    kind: "needs_sandbox",
                    what: message.what === "indexeddb" || message.what === "pages" ? message.what : "other",
                });
                return;
            case "xdc.listen": {
                await this.started;
                this.unsubscribe?.();
                this.post({ type: "xdc.updates", updates: this.updates.since(Number(message.serial) || 0) });
                this.unsubscribe = this.updates.onUpdates((fresh) =>
                    this.post({ type: "xdc.updates", updates: fresh }),
                );
                this.post({ type: "xdc.listening" });
                return;
            }
            case "xdc.sendUpdate":
                try {
                    await this.updates.send(message.update, typeof message.descr === "string" ? message.descr : "");
                } catch (e) {
                    if (!(e instanceof WebxdcUpdateTooLargeError)) logger.warn("webxdc: could not send a move", e);
                    this.options.onSendFailed();
                }
                return;
            case "xdc.save": {
                const data = message.data;
                // What's kept now is what the frame gets if it reloads (the server may not have it yet).
                const cleaned = cleanWebxdcSave(data);
                const kept = cleaned ? { data: cleaned, updated: Date.now() } : null;
                this.stored = storeWebxdcSave(client, archive.saveKey, data).then(
                    (stored) => {
                        if (!stored) logger.warn("webxdc: a save was too big to keep");
                        return stored;
                    },
                    (e) => {
                        logger.warn("webxdc: could not keep the game's save", e);
                        return false;
                    },
                );
                this.save = this.stored.then(() => kept);
                this.track(this.stored);
                return;
            }
            case "xdc.flushed":
                this.flushes.get(Number(message.id))?.();
                return;
            case "xdc.rtJoin":
                if (this.leaveRealtime) return;
                try {
                    this.leaveRealtime = WebxdcRealtime.for(client).join(roomId, this.options.eventId, (data) =>
                        this.post({ type: "xdc.realtime", data }),
                    );
                } catch (e) {
                    logger.info("webxdc: no realtime channel here", e);
                    this.post({ type: "xdc.realtimeUnavailable" });
                }
                return;
            case "xdc.rtSend":
                if (!this.leaveRealtime || !(message.data instanceof Uint8Array)) return;
                WebxdcRealtime.for(client)
                    .send(roomId, this.options.eventId, message.data)
                    .catch((e) => logger.info("webxdc: a realtime packet didn't go out", e));
                return;
            case "xdc.rtLeave":
                this.leaveRealtime?.();
                this.leaveRealtime = undefined;
                return;
            case "xdc.crash":
                logger.warn("webxdc: the game reported an error:", String(message.message ?? "").slice(0, 500));
                return;
            case "xdc.error":
                this.problem({
                    kind: "failed",
                    message: typeof message.message === "string" ? message.message : undefined,
                });
                return;
        }
    }
}

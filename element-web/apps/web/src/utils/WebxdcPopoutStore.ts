/*
 * Haven: webxdc games popped out into windows of their own.
 *
 * A popped-out game runs in the same pop-out page widgets use (widget_popout.html, see
 * src/apps/framework/widgetPopout/), which holds the game's frame and relays its messages. The
 * game's session (WebxdcSession) runs here in the main window, apart from the timeline, so the game
 * keeps going while the user switches rooms or scrolls it out of view. Closing the window, or
 * "Bring back here" on the game's card, ends it.
 *
 * Popups can be refused, by a browser's popup blocker or a desktop wrapper that sends new windows
 * to the system browser. popOut() then returns false, or calls onFailed() when the window never
 * answers.
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import {
    POPOUT_MESSAGE_KEY,
    POPOUT_PAGE,
    POPOUT_WINDOW_NAME_PREFIX,
    type FromPopout,
    type ToPopout,
} from "../../../../../src/apps/framework/widgetPopout/protocol";
import { type WebxdcArchive, type WebxdcSandbox } from "./webxdc";
import { WebxdcSession, type WebxdcSessionProblem } from "./WebxdcSession";

/**
 * The game frame's sandbox flags, as in the timeline. The bundled sandbox is served from Haven's own
 * origin, so its frame mustn't keep that origin: without allow-same-origin it gets one of its own.
 */
export function webxdcFrameSandbox(sandbox: WebxdcSandbox): string {
    return sandbox.bundled
        ? "allow-scripts allow-forms allow-pointer-lock"
        : "allow-scripts allow-same-origin allow-forms allow-pointer-lock";
}
export const WEBXDC_IFRAME_ALLOW = "fullscreen; autoplay";

const READY_TIMEOUT_MS = 5000;
const CLOSED_POLL_MS = 1000;

export interface WebxdcPopOutRequest {
    client: MatrixClient;
    roomId: string;
    eventId: string;
    /**
     * The game's files. The window has to open straight from the click, before a game that hasn't
     * been played yet is downloaded, so this can still be on its way; undefined if it couldn't be.
     */
    archive: WebxdcArchive | Promise<WebxdcArchive | undefined>;
    sandbox: WebxdcSandbox;
    name: string;
    /** The window opened but never answered, e.g. a wrapper took it elsewhere. */
    onFailed: () => void;
    /** The game stopped, and its window was closed. */
    onProblem?: (problem: WebxdcSessionProblem) => void;
}

interface Entry {
    request: WebxdcPopOutRequest;
    popup: Window;
    session: WebxdcSession | null;
    started: boolean;
    readyTimer: ReturnType<typeof setTimeout>;
    closedPoll: ReturnType<typeof setInterval>;
}

export class WebxdcPopoutStore {
    private static internalInstance?: WebxdcPopoutStore;

    public static get instance(): WebxdcPopoutStore {
        WebxdcPopoutStore.internalInstance ??= new WebxdcPopoutStore(window);
        return WebxdcPopoutStore.internalInstance;
    }

    /** By the game's file event id. */
    private readonly entries = new Map<string, Entry>();
    private readonly listeners = new Set<() => void>();

    public constructor(private readonly win: Window) {
        win.addEventListener("message", this.onMessage);
        // A pop-out can't work without the main window, so close them all with it.
        win.addEventListener("pagehide", this.closeAll);
    }

    public isPoppedOut(eventId: string): boolean {
        return this.entries.has(eventId);
    }

    /** Calls `listener` whenever a game pops out or comes back. Returns the unsubscribe function. */
    public subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * Pops the game out into its own window. Must be called from a click, or popup blockers
     * refuse it. Returns false when the window couldn't be opened at all.
     */
    public popOut(request: WebxdcPopOutRequest): boolean {
        const existing = this.entries.get(request.eventId);
        if (existing) {
            existing.popup.focus();
            return true;
        }

        const url = new URL(POPOUT_PAGE, this.win.location.href).toString();
        const name = POPOUT_WINDOW_NAME_PREFIX + "xdc_" + request.eventId.replace(/[^A-Za-z0-9]/g, "_");
        let popup: Window | null = null;
        try {
            popup = this.win.open(url, name, "popup=yes,width=480,height=720");
        } catch (e) {
            logger.warn("webxdc: the pop-out window was refused", e);
        }
        if (!popup) return false;

        const opened = popup;
        const entry: Entry = {
            request,
            popup: opened,
            session: null,
            started: false,
            readyTimer: setTimeout(() => {
                if (this.entries.get(request.eventId) !== entry || entry.started) return;
                logger.warn("webxdc: the pop-out window never answered");
                this.popIn(request.eventId);
                request.onFailed();
            }, READY_TIMEOUT_MS),
            closedPoll: setInterval(() => {
                if (opened.closed) this.popIn(request.eventId);
            }, CLOSED_POLL_MS),
        };
        this.entries.set(request.eventId, entry);
        this.emit();
        return true;
    }

    public focus(eventId: string): void {
        this.entries.get(eventId)?.popup.focus();
    }

    /** Closes the game's window and ends the game. */
    public popIn(eventId: string): void {
        const entry = this.entries.get(eventId);
        if (!entry) return;
        this.entries.delete(eventId);
        clearTimeout(entry.readyTimer);
        clearInterval(entry.closedPoll);
        entry.session?.stop();
        if (!entry.popup.closed) entry.popup.close();
        this.emit();
    }

    private readonly closeAll = (): void => {
        for (const eventId of [...this.entries.keys()]) this.popIn(eventId);
    };

    private emit(): void {
        for (const listener of [...this.listeners]) listener();
    }

    private toPopup(popup: Window, message: ToPopout): void {
        if (!popup.closed) popup.postMessage(message, this.win.location.origin);
    }

    private entryFor(source: MessageEventSource | null): Entry | undefined {
        for (const entry of this.entries.values()) {
            if (entry.popup === source) return entry;
        }
        return undefined;
    }

    private readonly onMessage = (ev: MessageEvent): void => {
        if (ev.origin !== this.win.location.origin) return;
        const message = ev.data as FromPopout | undefined;
        const type = message?.[POPOUT_MESSAGE_KEY];
        if (!type) return;
        const entry = this.entryFor(ev.source);
        if (!entry) return;
        switch (type) {
            case "ready":
                if (!entry.started) void this.start(entry);
                return;
            case "frameLoad":
                entry.session?.frameLoaded();
                return;
            case "in":
                entry.session?.handleMessage((message as { data: unknown }).data);
                return;
            case "closing":
                this.popIn(entry.request.eventId);
                return;
        }
    };

    private async start(entry: Entry): Promise<void> {
        entry.started = true;
        clearTimeout(entry.readyTimer);
        const { request, popup } = entry;
        const archive = await request.archive;
        if (this.entries.get(request.eventId) !== entry) return;
        if (!archive) {
            // The game couldn't be downloaded or opened; its card says why.
            this.popIn(request.eventId);
            return;
        }
        const session = new WebxdcSession({
            client: request.client,
            roomId: request.roomId,
            eventId: request.eventId,
            archive,
            sandbox: request.sandbox,
            post: (data, targetOrigin) => this.toPopup(popup, { [POPOUT_MESSAGE_KEY]: "out", data, targetOrigin }),
            onProblem: (problem) => {
                logger.warn("webxdc: a popped-out game stopped", problem);
                this.popIn(request.eventId);
                request.onProblem?.(problem);
            },
            onSendFailed: () => logger.warn("webxdc: a popped-out game's move couldn't be saved"),
        });
        entry.session = session;
        this.toPopup(popup, {
            [POPOUT_MESSAGE_KEY]: "load",
            src: session.src,
            title: request.name,
            allow: WEBXDC_IFRAME_ALLOW,
            sandbox: webxdcFrameSandbox(request.sandbox),
            background: "#ffffff",
        });
    }
}

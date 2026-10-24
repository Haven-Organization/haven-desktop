/*
 * Haven - widget pop-out windows
 *
 * Stock Element's pop-out button opens a widget's URL in a new browser tab, cut off from the
 * client. Widgets that need the client - to sign in with the user's OpenID token, to read room
 * events, and so on - can't work there. Haven instead opens its own window (widget_popout.html,
 * see popoutPage.ts) holding the widget's iframe, and runs the widget API connection for it from
 * the main window here, relaying the widget's messages through that window (see protocol.ts).
 *
 * The connection lives here rather than in the widget's tile, so the widget keeps running while
 * the user switches rooms. Closing the window, or "Bring back" in the tile, returns the widget to
 * the room.
 *
 * Popups can be refused: by a browser's popup blocker, or by a desktop wrapper that sends every
 * new window to the system browser. Then popOut() returns false (or calls onFailed() when the
 * window never answers), and the caller falls back to something else.
 */

import { logger } from "matrix-js-sdk/src/logger";

import { POPOUT_MESSAGE_KEY, POPOUT_PAGE, POPOUT_WINDOW_NAME_PREFIX, type FromPopout, type ToPopout } from "./protocol";

/** How long a new pop-out window has to say it's ready before it counts as refused. */
export const READY_TIMEOUT_MS = 5000;
const CLOSED_POLL_MS = 1000;

/** The parts of stock's WidgetMessaging that the pop-out uses. */
export interface PopoutMessaging {
    prepare(): Promise<void>;
    start(iframe: HTMLIFrameElement): void;
    stop(opts?: { forceDestroy: boolean }): void;
    readonly widgetApi: { transport: unknown } | null;
}

export interface PopOutRequest {
    /** The widget's UID (WidgetUtils.getWidgetUid). */
    uid: string;
    title: string;
    /** The URL the widget's iframe loads: the same one it loads embedded. */
    src: string;
    allow: string;
    sandbox: string;
    background: string;
    width: number;
    height: number;
    /** A new widget API connection for the widget, not yet started. */
    createMessaging: () => PopoutMessaging;
    /** Called when the window opened but never answered, e.g. a wrapper took it elsewhere. */
    onFailed: () => void;
}

/**
 * Stands in for the widget's iframe for stock's ClientWidgetApi, which only needs its
 * contentWindow to post to and a "load" event. Posting goes to the pop-out window instead.
 */
class RelayFrame extends EventTarget {
    public src = "";
    public readonly contentWindow: { postMessage(data: unknown, targetOrigin: string): void };

    public constructor(post: (message: ToPopout) => void) {
        super();
        this.contentWindow = {
            postMessage: (data, targetOrigin): void => post({ [POPOUT_MESSAGE_KEY]: "out", data, targetOrigin }),
        };
    }
}

interface Entry {
    request: PopOutRequest;
    popup: Window;
    frame: RelayFrame;
    messaging: PopoutMessaging | null;
    readyTimer: ReturnType<typeof setTimeout>;
    closedPoll: ReturnType<typeof setInterval>;
}

export class WidgetPopoutStore {
    private static internalInstance?: WidgetPopoutStore;

    public static get instance(): WidgetPopoutStore {
        WidgetPopoutStore.internalInstance ??= new WidgetPopoutStore(window);
        return WidgetPopoutStore.internalInstance;
    }

    private readonly entries = new Map<string, Entry>();
    private readonly listeners = new Set<() => void>();

    public constructor(private readonly win: Window) {
        win.addEventListener("message", this.onMessage);
        // A pop-out can't work without the main window, so close them all with it.
        win.addEventListener("pagehide", this.closeAll);
    }

    public isPoppedOut(uid: string): boolean {
        return this.entries.has(uid);
    }

    /** Calls `listener` whenever a widget pops out or comes back. Returns the unsubscribe function. */
    public subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * Pops the widget out into its own window. Must be called from a click, or popup blockers
     * refuse it. Returns false when the window couldn't be opened at all.
     */
    public popOut(request: PopOutRequest): boolean {
        const existing = this.entries.get(request.uid);
        if (existing) {
            existing.popup.focus();
            return true;
        }

        const url = new URL(POPOUT_PAGE, this.win.location.href).toString();
        const name = POPOUT_WINDOW_NAME_PREFIX + request.uid.replace(/[^A-Za-z0-9]/g, "_");
        const width = Math.max(320, Math.round(request.width));
        const height = Math.max(240, Math.round(request.height));
        let popup: Window | null = null;
        try {
            popup = this.win.open(url, name, `popup=yes,width=${width},height=${height}`);
        } catch (e) {
            logger.warn("Widget pop-out window was refused", e);
        }
        if (!popup) return false;

        const opened = popup;
        const entry: Entry = {
            request,
            popup: opened,
            frame: new RelayFrame((message) => this.post(opened, message)),
            messaging: null,
            readyTimer: setTimeout(() => {
                if (this.entries.get(request.uid) !== entry || entry.messaging) return;
                logger.warn("Widget pop-out window never answered");
                this.popIn(request.uid);
                request.onFailed();
            }, READY_TIMEOUT_MS),
            closedPoll: setInterval(() => {
                if (opened.closed) this.popIn(request.uid);
            }, CLOSED_POLL_MS),
        };
        this.entries.set(request.uid, entry);
        this.emit();
        return true;
    }

    public focus(uid: string): void {
        this.entries.get(uid)?.popup.focus();
    }

    /** Closes the widget's window and ends its connection, so the room can load it again. */
    public popIn(uid: string): void {
        const entry = this.entries.get(uid);
        if (!entry) return;
        this.entries.delete(uid);
        clearTimeout(entry.readyTimer);
        clearInterval(entry.closedPoll);
        try {
            entry.messaging?.stop({ forceDestroy: true });
        } catch (e) {
            logger.warn("Failed to stop popped-out widget", e);
        }
        if (!entry.popup.closed) entry.popup.close();
        this.emit();
    }

    private readonly closeAll = (): void => {
        for (const uid of [...this.entries.keys()]) this.popIn(uid);
    };

    private emit(): void {
        for (const listener of [...this.listeners]) listener();
    }

    private post(popup: Window, message: ToPopout): void {
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
                if (entry.messaging) return;
                clearTimeout(entry.readyTimer);
                void this.start(entry);
                return;
            case "frameLoad":
                entry.frame.dispatchEvent(new Event("load"));
                return;
            case "in": {
                // Hand the widget's message to the connection's transport, as if the widget had
                // posted it to this window directly, the way it does when embedded.
                const transport = entry.messaging?.widgetApi?.transport as
                    | { handleMessage?: (ev: { data: unknown }) => void }
                    | undefined;
                transport?.handleMessage?.({ data: (message as { data: unknown }).data });
                return;
            }
            case "closing":
                this.popIn(entry.request.uid);
                return;
        }
    };

    private async start(entry: Entry): Promise<void> {
        const { request } = entry;
        const messaging = request.createMessaging();
        entry.messaging = messaging;
        try {
            await messaging.prepare();
        } catch (e) {
            logger.warn("Failed to prepare popped-out widget", e);
        }
        if (this.entries.get(request.uid) !== entry) return;
        try {
            messaging.start(entry.frame as unknown as HTMLIFrameElement);
        } catch (e) {
            logger.error("Failed to start popped-out widget", e);
            this.popIn(request.uid);
            request.onFailed();
            return;
        }
        this.post(entry.popup, {
            [POPOUT_MESSAGE_KEY]: "load",
            src: request.src,
            title: request.title,
            allow: request.allow,
            sandbox: request.sandbox,
            background: request.background,
        });
    }
}

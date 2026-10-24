/*
 * Haven - WidgetPopoutStore tests
 */

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { READY_TIMEOUT_MS, WidgetPopoutStore, type PopOutRequest, type PopoutMessaging } from "./WidgetPopoutStore";
import { POPOUT_MESSAGE_KEY as K } from "./protocol";

const ORIGIN = "https://haven.example.org";

class FakePopup {
    public closed = false;
    public postMessage = vi.fn();
    public focus = vi.fn();
    public close = vi.fn(() => {
        this.closed = true;
    });
}

class FakeMainWindow extends EventTarget {
    public location = { origin: ORIGIN, href: `${ORIGIN}/haven/#/room/!a:example.org` };
    public popup: FakePopup | null = new FakePopup();
    public open = vi.fn(() => this.popup);
}

function fakeMessaging(): PopoutMessaging & { handleMessage: ReturnType<typeof vi.fn>; frame?: any } {
    const handleMessage = vi.fn();
    const messaging: any = {
        handleMessage,
        widgetApi: null,
        prepare: vi.fn(async () => {}),
        start: vi.fn((frame: unknown) => {
            messaging.frame = frame;
            messaging.widgetApi = { transport: { handleMessage } };
        }),
        stop: vi.fn(),
    };
    return messaging;
}

function request(overrides: Partial<PopOutRequest> = {}): PopOutRequest {
    return {
        uid: "game_!room:example.org",
        title: "CrappyBird",
        src: "https://widget.example.org/play?widgetId=game",
        allow: "autoplay;",
        sandbox: "allow-scripts allow-same-origin",
        background: "rgb(16, 19, 23)",
        width: 600,
        height: 800,
        createMessaging: fakeMessaging,
        onFailed: vi.fn(),
        ...overrides,
    };
}

function fromPopup(win: FakeMainWindow, data: unknown, source: unknown = win.popup, origin = ORIGIN): void {
    win.dispatchEvent(Object.assign(new Event("message"), { data, source, origin }));
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("WidgetPopoutStore", () => {
    let win: FakeMainWindow;
    let store: WidgetPopoutStore;

    beforeEach(() => {
        win = new FakeMainWindow();
        store = new WidgetPopoutStore(win as unknown as Window);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("opens Haven's pop-out page in a named window the size of the tile", () => {
        expect(store.popOut(request())).toBe(true);
        expect(win.open).toHaveBeenCalledWith(
            `${ORIGIN}/haven/widget_popout.html`,
            "haven_widget_popout_game__room_example_org",
            "popup=yes,width=600,height=800",
        );
        expect(store.isPoppedOut("game_!room:example.org")).toBe(true);
    });

    it("reports a refused window so the caller can fall back", () => {
        win.popup = null;
        expect(store.popOut(request())).toBe(false);
        expect(store.isPoppedOut("game_!room:example.org")).toBe(false);
    });

    it("starts the widget's connection when the window is ready, then loads the widget there", async () => {
        const messaging = fakeMessaging();
        store.popOut(request({ createMessaging: () => messaging }));
        fromPopup(win, { [K]: "ready" });
        await flush();

        expect(messaging.prepare).toHaveBeenCalled();
        expect(messaging.start).toHaveBeenCalled();
        expect(win.popup!.postMessage).toHaveBeenCalledWith(
            {
                [K]: "load",
                src: "https://widget.example.org/play?widgetId=game",
                title: "CrappyBird",
                allow: "autoplay;",
                sandbox: "allow-scripts allow-same-origin",
                background: "rgb(16, 19, 23)",
            },
            ORIGIN,
        );
    });

    it("relays the widget's messages both ways and its iframe's load", async () => {
        const messaging = fakeMessaging();
        store.popOut(request({ createMessaging: () => messaging }));
        fromPopup(win, { [K]: "ready" });
        await flush();

        const request1 = { api: "fromWidget", action: "get_openid", requestId: "1", widgetId: "game" };
        fromPopup(win, { [K]: "in", data: request1 });
        expect(messaging.handleMessage).toHaveBeenCalledWith({ data: request1 });

        messaging.frame.contentWindow.postMessage({ api: "toWidget", action: "x" }, "https://widget.example.org");
        expect(win.popup!.postMessage).toHaveBeenLastCalledWith(
            { [K]: "out", data: { api: "toWidget", action: "x" }, targetOrigin: "https://widget.example.org" },
            ORIGIN,
        );

        const onLoad = vi.fn();
        messaging.frame.addEventListener("load", onLoad);
        fromPopup(win, { [K]: "frameLoad" });
        expect(onLoad).toHaveBeenCalled();
    });

    it("ignores messages from other origins and other windows", async () => {
        const messaging = fakeMessaging();
        store.popOut(request({ createMessaging: () => messaging }));
        fromPopup(win, { [K]: "ready" }, win.popup, "https://evil.example.org");
        fromPopup(win, { [K]: "ready" }, new FakePopup());
        await flush();
        expect(messaging.start).not.toHaveBeenCalled();
    });

    it("brings the widget back when its window closes", async () => {
        const messaging = fakeMessaging();
        const changed = vi.fn();
        store.subscribe(changed);
        store.popOut(request({ createMessaging: () => messaging }));
        fromPopup(win, { [K]: "ready" });
        await flush();

        fromPopup(win, { [K]: "closing" });
        expect(messaging.stop).toHaveBeenCalledWith({ forceDestroy: true });
        expect(store.isPoppedOut("game_!room:example.org")).toBe(false);
        expect(changed).toHaveBeenCalledTimes(2);
    });

    it("closes the window when brought back from the room", () => {
        store.popOut(request());
        const popup = win.popup!;
        store.popIn("game_!room:example.org");
        expect(popup.close).toHaveBeenCalled();
        expect(store.isPoppedOut("game_!room:example.org")).toBe(false);
    });

    it("focuses the existing window instead of opening another", () => {
        store.popOut(request());
        expect(store.popOut(request())).toBe(true);
        expect(win.open).toHaveBeenCalledTimes(1);
        expect(win.popup!.focus).toHaveBeenCalled();
    });

    it("falls back when the window never answers", () => {
        vi.useFakeTimers();
        const onFailed = vi.fn();
        store.popOut(request({ onFailed }));
        vi.advanceTimersByTime(READY_TIMEOUT_MS);
        expect(onFailed).toHaveBeenCalled();
        expect(win.popup!.close).toHaveBeenCalled();
        expect(store.isPoppedOut("game_!room:example.org")).toBe(false);
    });

    it("closes every pop-out with the main window", () => {
        store.popOut(request());
        const popup = win.popup!;
        win.dispatchEvent(new Event("pagehide"));
        expect(popup.close).toHaveBeenCalled();
    });
});

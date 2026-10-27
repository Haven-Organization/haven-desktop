/*
 * Haven: tests for webxdc games popped out into their own windows.
 */

// @vitest-environment happy-dom

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { getMockClientWithEventEmitter } from "test-utils";
import { POPOUT_MESSAGE_KEY } from "../../../../../src/apps/framework/widgetPopout/protocol";
import { type WebxdcArchive } from "./webxdc";
import { WebxdcPopoutStore } from "./WebxdcPopoutStore";

const archive: WebxdcArchive = {
    saveKey: "0123456789abcdef",
    manifest: {},
    files: [["index.html", new ArrayBuffer(4), "text/html"]],
};

function fakePopup() {
    return { closed: false, postMessage: vi.fn(), focus: vi.fn(), close: vi.fn() };
}

describe("WebxdcPopoutStore", () => {
    let client: MatrixClient;
    let popup: ReturnType<typeof fakePopup>;
    let win: Window;
    let store: WebxdcPopoutStore;
    let onMessage: (ev: Partial<MessageEvent>) => void;

    beforeEach(() => {
        vi.useFakeTimers();
        client = getMockClientWithEventEmitter({
            relations: vi.fn().mockResolvedValue({ events: [], nextBatch: null }),
            getSafeUserId: vi.fn().mockReturnValue("@alice:example.org"),
            getRoom: vi.fn().mockReturnValue(null),
            getAccountData: vi.fn().mockReturnValue(undefined),
        });
        popup = fakePopup();
        win = {
            location: { href: "https://app.example.org/", origin: "https://app.example.org" },
            open: vi.fn().mockReturnValue(popup),
            addEventListener: vi.fn((type: string, fn: (ev: Partial<MessageEvent>) => void) => {
                if (type === "message") onMessage = fn;
            }),
        } as unknown as Window;
        store = new WebxdcPopoutStore(win);
    });

    afterEach(() => {
        store.popIn("$game");
        vi.useRealTimers();
    });

    const request = (onFailed = vi.fn()) => ({
        client,
        roomId: "!room:example.org",
        eventId: "$game",
        archive,
        sandbox: {
            base: "https://games.example.org/",
            page: "https://games.example.org/loader.html",
            origin: "https://games.example.org",
            bundled: false,
        },
        name: "Chess",
        onFailed,
    });
    const fromPopup = (data: unknown): void =>
        onMessage({ origin: "https://app.example.org", source: popup as unknown as Window, data });

    it("opens the pop-out page in a window the desktop apps let through", () => {
        expect(store.popOut(request())).toBe(true);
        expect(win.open).toHaveBeenCalledWith(
            "https://app.example.org/widget_popout.html",
            expect.stringMatching(/^haven_widget_popout_xdc_/),
            expect.any(String),
        );
        expect(store.isPoppedOut("$game")).toBe(true);
    });

    it("loads the game in the window once it's ready, and relays its messages", async () => {
        store.popOut(request());
        fromPopup({ [POPOUT_MESSAGE_KEY]: "ready" });
        await vi.waitFor(() => expect(popup.postMessage).toHaveBeenCalled());
        const load = popup.postMessage.mock.calls[0][0];
        expect(load).toMatchObject({ [POPOUT_MESSAGE_KEY]: "load", title: "Chess" });
        const token = /#t=([a-z0-9]+)/.exec(load.src)![1];

        fromPopup({ [POPOUT_MESSAGE_KEY]: "in", data: { type: "xdc.ready", token } });
        await vi.waitFor(() => expect(popup.postMessage).toHaveBeenCalledTimes(2));
        expect(popup.postMessage).toHaveBeenLastCalledWith(
            {
                [POPOUT_MESSAGE_KEY]: "out",
                data: expect.objectContaining({ type: "xdc.files", token }),
                targetOrigin: "https://games.example.org",
            },
            "https://app.example.org",
        );
    });

    it("gives the bundled sandbox's frame an origin of its own", async () => {
        const bundled = {
            base: "https://app.example.org/webxdc-sandbox/game/",
            page: "https://app.example.org/webxdc-sandbox/game/index.html",
            origin: "null",
            bundled: true,
        };
        store.popOut({ ...request(), sandbox: bundled });
        fromPopup({ [POPOUT_MESSAGE_KEY]: "ready" });
        await vi.waitFor(() => expect(popup.postMessage).toHaveBeenCalled());
        const load = popup.postMessage.mock.calls[0][0];
        expect(load.sandbox).not.toContain("allow-same-origin");
        expect(load.src.startsWith(bundled.page + "#t=")).toBe(true);
    });

    it("says why a popped-out game stopped", async () => {
        const onProblem = vi.fn();
        store.popOut({ ...request(), onProblem });
        fromPopup({ [POPOUT_MESSAGE_KEY]: "ready" });
        await vi.waitFor(() => expect(popup.postMessage).toHaveBeenCalled());
        const token = /#t=([a-z0-9]+)/.exec(popup.postMessage.mock.calls[0][0].src)![1];
        fromPopup({ [POPOUT_MESSAGE_KEY]: "in", data: { type: "xdc.error", token, message: "broken" } });
        expect(onProblem).toHaveBeenCalledWith({ kind: "failed", message: "broken" });
        expect(store.isPoppedOut("$game")).toBe(false);
    });

    it("waits for a game still downloading before loading it in the window", async () => {
        let finish!: (archive: WebxdcArchive | undefined) => void;
        store.popOut({ ...request(), archive: new Promise((resolve) => (finish = resolve)) });
        fromPopup({ [POPOUT_MESSAGE_KEY]: "ready" });
        await Promise.resolve();
        expect(popup.postMessage).not.toHaveBeenCalled();

        finish(archive);
        await vi.waitFor(() =>
            expect(popup.postMessage).toHaveBeenCalledWith(
                expect.objectContaining({ [POPOUT_MESSAGE_KEY]: "load" }),
                "https://app.example.org",
            ),
        );
    });

    it("closes the window when the game couldn't be downloaded", async () => {
        store.popOut({ ...request(), archive: Promise.resolve(undefined) });
        fromPopup({ [POPOUT_MESSAGE_KEY]: "ready" });
        await vi.waitFor(() => expect(store.isPoppedOut("$game")).toBe(false));
        expect(popup.close).toHaveBeenCalled();
    });

    it("says so when the window never answers", () => {
        const onFailed = vi.fn();
        store.popOut(request(onFailed));
        vi.advanceTimersByTime(6000);
        expect(onFailed).toHaveBeenCalled();
        expect(store.isPoppedOut("$game")).toBe(false);
    });

    it("ends the game when its window closes", () => {
        store.popOut(request());
        fromPopup({ [POPOUT_MESSAGE_KEY]: "ready" });
        popup.closed = true;
        vi.advanceTimersByTime(1500);
        expect(store.isPoppedOut("$game")).toBe(false);
    });

    describe("with the game playing in its window", () => {
        let token: string;

        beforeEach(async () => {
            store.popOut(request());
            fromPopup({ [POPOUT_MESSAGE_KEY]: "ready" });
            await vi.waitFor(() => expect(popup.postMessage).toHaveBeenCalled());
            token = /#t=([a-z0-9]+)/.exec(popup.postMessage.mock.calls[0][0].src)![1];
            fromPopup({ [POPOUT_MESSAGE_KEY]: "in", data: { type: "xdc.ready", token } });
            await vi.waitFor(() => expect(popup.postMessage).toHaveBeenCalledTimes(2));
        });

        /** The game's page answers the flush Haven asked for. */
        function answerFlush(): void {
            const ask = popup.postMessage.mock.calls
                .map(([m]) => m.data)
                .reverse()
                .find((d) => d?.type === "xdc.flush");
            fromPopup({ [POPOUT_MESSAGE_KEY]: "in", data: { type: "xdc.flushed", token, id: ask.id } });
        }

        it("saves the game now", async () => {
            const saved = store.saveNow("$game");
            answerFlush();
            await expect(saved).resolves.toBe(true);
        });

        it("has the game hand over its save before closing its window to pop it in", async () => {
            const back = store.bringBack("$game");
            expect(popup.close).not.toHaveBeenCalled();
            answerFlush();
            await back;
            expect(popup.close).toHaveBeenCalled();
            expect(store.isPoppedOut("$game")).toBe(false);
        });
    });

    it("can't save a game that isn't popped out", async () => {
        await expect(store.saveNow("$other")).resolves.toBe(false);
    });

    it("returns false when the window is refused", () => {
        vi.mocked(win.open).mockReturnValue(null);
        expect(store.popOut(request())).toBe(false);
        expect(store.isPoppedOut("$game")).toBe(false);
    });
});

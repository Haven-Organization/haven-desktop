/*
 * Haven: tests for a run of a webxdc game.
 */

// @vitest-environment happy-dom

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { getMockClientWithEventEmitter } from "test-utils";
import { type WebxdcArchive, type WebxdcSandbox } from "./webxdc";
import { WebxdcSession, type WebxdcSessionOptions } from "./WebxdcSession";

const archive: WebxdcArchive = {
    saveKey: "0123456789abcdef",
    manifest: { name: "Chess" },
    files: [["index.html", new ArrayBuffer(4), "text/html"]],
};

const configured: WebxdcSandbox = {
    base: "https://games.example.org/",
    page: "https://games.example.org/loader.html",
    origin: "https://games.example.org",
    bundled: false,
};
const bundled: WebxdcSandbox = {
    base: "https://app.example.org/webxdc-sandbox/game/",
    page: "https://app.example.org/webxdc-sandbox/game/index.html",
    origin: "null",
    bundled: true,
};

describe("WebxdcSession", () => {
    let client: MatrixClient;
    let post: ReturnType<typeof vi.fn>;
    let onProblem: ReturnType<typeof vi.fn>;
    let session: WebxdcSession;

    beforeEach(() => {
        vi.useFakeTimers();
        client = getMockClientWithEventEmitter({
            relations: vi.fn().mockResolvedValue({ events: [], nextBatch: null }),
            sendEvent: vi.fn().mockResolvedValue({ event_id: "$move" }),
            getSafeUserId: vi.fn().mockReturnValue("@alice:example.org"),
            getRoom: vi.fn().mockReturnValue(null),
            getAccountData: vi.fn().mockReturnValue(undefined),
            setAccountData: vi.fn(),
        });
        post = vi.fn();
        onProblem = vi.fn();
        session = start(configured);
    });

    function start(sandbox: WebxdcSandbox): WebxdcSession {
        session?.stop();
        return new WebxdcSession({
            client,
            roomId: "!room:example.org",
            eventId: "$game",
            archive,
            sandbox,
            post: post as WebxdcSessionOptions["post"],
            onProblem,
            onSendFailed: vi.fn(),
        } as WebxdcSessionOptions);
    }

    afterEach(() => {
        session.stop();
        vi.useRealTimers();
    });

    it("opens the sandbox's loader with its token and Haven's origin", () => {
        expect(session.src).toBe(
            `https://games.example.org/loader.html#t=${session.token}&o=${encodeURIComponent(window.location.origin)}`,
        );
        expect(session.origin).toBe("https://games.example.org");
    });

    it("hands over the game's files, and the player's save, when the sandbox is ready", async () => {
        vi.mocked(client.getAccountData).mockReturnValue({
            getContent: () => ({ data: { level: "3" }, updated: 5 }),
        } as any);
        expect(session.handleMessage({ type: "xdc.ready", token: session.token })).toBe(true);
        await vi.waitFor(() => expect(post).toHaveBeenCalled());
        expect(post).toHaveBeenCalledWith(
            expect.objectContaining({
                meta: expect.objectContaining({ saveKey: "0123456789abcdef", save: { level: "3" }, saveUpdated: 5 }),
            }),
            "https://games.example.org",
        );
        expect(post).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "xdc.files",
                token: session.token,
                files: archive.files,
                meta: expect.objectContaining({ selfAddr: "@alice:example.org" }),
            }),
            "https://games.example.org",
        );
    });

    it("keeps the game's save for the player", async () => {
        vi.mocked(client.setAccountData).mockResolvedValue({} as any);
        session.handleMessage({ type: "xdc.save", token: session.token, data: { level: "4" } });
        await vi.waitFor(() =>
            expect(client.setAccountData).toHaveBeenCalledWith(
                "software.haven.webxdc.save.0123456789abcdef",
                expect.objectContaining({ data: { level: "4" } }),
            ),
        );
    });

    it("ignores messages for another run of the game", () => {
        expect(session.handleMessage({ type: "xdc.ready", token: "someone-else" })).toBe(false);
        expect(post).not.toHaveBeenCalled();
    });

    it("gives the game its moves so far when it listens", async () => {
        session.handleMessage({ type: "xdc.listen", token: session.token, serial: 0 });
        await vi.waitFor(() =>
            expect(post).toHaveBeenCalledWith(
                { type: "xdc.listening", token: session.token },
                "https://games.example.org",
            ),
        );
        expect(post).toHaveBeenCalledWith(
            { type: "xdc.updates", updates: [], token: session.token },
            "https://games.example.org",
        );
    });

    it("stops a game whose frame goes to a page outside the sandbox", () => {
        session.handleMessage({ type: "xdc.ready", token: session.token });
        session.frameLoaded(); // the loader
        session.handleMessage({ type: "xdc.page", token: session.token });
        session.frameLoaded(); // the game's page
        // Another of the game's pages: its own message may come before the frame's load.
        session.handleMessage({ type: "xdc.leaving", token: session.token });
        session.handleMessage({ type: "xdc.page", token: session.token });
        session.frameLoaded();
        vi.advanceTimersByTime(5000);
        expect(onProblem).not.toHaveBeenCalled();

        session.handleMessage({ type: "xdc.leaving", token: session.token });
        session.frameLoaded(); // a page that never said it's the game's
        vi.advanceTimersByTime(5000);
        expect(onProblem).toHaveBeenCalledWith({ kind: "left_sandbox" });
    });

    it("isn't fooled by loads that aren't a new page", () => {
        session.handleMessage({ type: "xdc.ready", token: session.token });
        session.handleMessage({ type: "xdc.page", token: session.token });
        session.frameLoaded(); // Firefox, as the bundled sandbox writes the game's page
        session.frameLoaded();
        vi.advanceTimersByTime(5000);
        expect(onProblem).not.toHaveBeenCalled();
    });

    describe("in the bundled sandbox", () => {
        beforeEach(() => {
            session = start(bundled);
        });

        it("opens the bundled page, and posts to the frame's origin of its own", async () => {
            expect(session.src).toBe(
                `${bundled.page}#t=${session.token}&o=${encodeURIComponent(window.location.origin)}`,
            );
            expect(session.origin).toBe("null");
            session.handleMessage({ type: "xdc.ready", token: session.token });
            await vi.waitFor(() =>
                expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "xdc.files" }), "*"),
            );
        });

        it.each([
            ["indexeddb", "indexeddb"],
            ["pages", "pages"],
            ["something else", "other"],
        ])("says when the game needs a sandbox URL for %s", (what, need) => {
            session.handleMessage({ type: "xdc.limit", token: session.token, what });
            expect(onProblem).toHaveBeenCalledWith({ kind: "needs_sandbox", what: need });
        });
    });

    it("ignores limits outside the bundled sandbox", () => {
        session.handleMessage({ type: "xdc.limit", token: session.token, what: "pages" });
        expect(onProblem).not.toHaveBeenCalled();
    });

    it("doesn't check pages before the game opens", () => {
        session.frameLoaded();
        vi.advanceTimersByTime(5000);
        expect(onProblem).not.toHaveBeenCalled();
    });

    it("gives up when the sandbox never starts", () => {
        vi.advanceTimersByTime(31_000);
        expect(onProblem).toHaveBeenCalledWith({ kind: "failed" });
    });
});

/*
 * Haven: tests for the desktop app's webxdc game sandbox.
 */

import { describe, expect, it } from "vitest";
import path from "node:path";

import {
    isInWebxdcFrame,
    isWebxdcNavigationBlocked,
    isWebxdcPermissionRequest,
    isWebxdcRequestBlocked,
    webxdcSandboxFile,
} from "./webxdc-sandbox";

const GAME = "0123456789abcdef0123456789abcdef";
const app = { url: "vector://vector/webapp/", parent: null };
const game = { url: `webxdc://${GAME}/app/token/index.html`, parent: app };
const inner = { url: "about:blank", parent: game };

describe("webxdcSandboxFile", () => {
    it("serves the sandbox's own files", () => {
        expect(webxdcSandboxFile(`webxdc://${GAME}/loader.html`, "/app/webapp")).toBe(
            path.join("/app/webapp", "webxdc-sandbox", "loader.html"),
        );
        expect(webxdcSandboxFile(`webxdc://${GAME}/sw.js`, "/app/webapp")).toBe(
            path.join("/app/webapp", "webxdc-sandbox", "sw.js"),
        );
        expect(webxdcSandboxFile(`webxdc://${GAME}/runtime.js`, "/app/webapp")).toBe(
            path.join("/app/webapp", "webxdc-sandbox", "runtime.js"),
        );
    });

    it.each([
        `webxdc://${GAME}/../index.html`,
        `webxdc://${GAME}/app/token/index.html`,
        `webxdc://${GAME}/config.json`,
        "webxdc://not_a_game/loader.html",
        `vector://vector/loader.html`,
    ])("serves nothing else: %s", (url) => {
        expect(webxdcSandboxFile(url, "/app/webapp")).toBeUndefined();
    });
});

describe("isInWebxdcFrame", () => {
    it("finds a game's frame and frames inside it", () => {
        expect(isInWebxdcFrame(game)).toBe(true);
        expect(isInWebxdcFrame(inner)).toBe(true);
        expect(isInWebxdcFrame(app)).toBe(false);
        expect(isInWebxdcFrame(null)).toBe(false);
    });
});

describe("isWebxdcRequestBlocked", () => {
    it("blocks a game's requests outside its sandbox", () => {
        expect(
            isWebxdcRequestBlocked({
                url: "https://example.org/track",
                frame: game,
            }),
        ).toBe(true);
        expect(
            isWebxdcRequestBlocked({
                url: "https://example.org/track",
                frame: inner,
            }),
        ).toBe(true);
        expect(
            isWebxdcRequestBlocked({
                url: "wss://example.org/",
                referrer: `webxdc://${GAME}/app/t/worker.js`,
            }),
        ).toBe(true);
    });

    it("lets the game's own files and the app's requests through", () => {
        expect(
            isWebxdcRequestBlocked({
                url: `webxdc://${GAME}/loader.js`,
                frame: game,
            }),
        ).toBe(false);
        expect(
            isWebxdcRequestBlocked({
                url: "https://matrix.example.org/_matrix/client",
                frame: app,
            }),
        ).toBe(false);
        expect(
            isWebxdcRequestBlocked({
                url: "https://matrix.example.org/_matrix/client",
            }),
        ).toBe(false);
    });
});

describe("isWebxdcNavigationBlocked", () => {
    it("keeps a game frame in its sandbox", () => {
        expect(isWebxdcNavigationBlocked(game, "https://example.org/")).toBe(true);
        expect(isWebxdcNavigationBlocked(game, "data:text/html,hi")).toBe(true);
        expect(isWebxdcNavigationBlocked(game, `webxdc://${GAME}/app/token/level2.html`)).toBe(false);
    });

    it("lets the app open the game", () => {
        expect(isWebxdcNavigationBlocked({ url: "about:blank", parent: app }, `webxdc://${GAME}/loader.html`)).toBe(
            false,
        );
    });
});

describe("isWebxdcPermissionRequest", () => {
    it("is a game's request", () => {
        expect(isWebxdcPermissionRequest(`webxdc://${GAME}/app/t/index.html`)).toBe(true);
        expect(isWebxdcPermissionRequest("vector://vector/webapp/")).toBe(false);
        expect(isWebxdcPermissionRequest(undefined)).toBe(false);
    });
});

/*
 * Haven: tests for Flash games played with Ruffle.
 */

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FlashModule = typeof import("./flash");

/** A fresh copy of the module, so Ruffle's files aren't kept from one test to the next. */
async function load(): Promise<FlashModule> {
    vi.resetModules();
    return import("./flash");
}

const movie = (signature = "CWS"): Blob => new Blob([signature, new Uint8Array([10, 1, 2, 3])]);

function serveRuffle(files: Record<string, string> | null): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async (url: URL | string) => {
        const name = String(url).split("/ruffle/")[1];
        if (!files) return new Response("", { status: 404 });
        if (name === "ruffle.json") return Response.json({ version: "0.7.1", files: Object.keys(files) });
        return name in files ? new Response(files[name]) : new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

describe("Flash games", () => {
    beforeEach(() => {
        vi.stubEnv("HAVEN_RUFFLE", "0.7.1");
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it("knows a Flash movie by its type or name", async () => {
        const { isFlashFile } = await load();
        expect(isFlashFile({ msgtype: "m.file", body: "game.swf", url: "mxc://example.org/a" })).toBe(true);
        expect(
            isFlashFile({
                msgtype: "m.file",
                body: "game",
                url: "mxc://example.org/a",
                info: { mimetype: "application/x-shockwave-flash" },
            }),
        ).toBe(true);
        expect(isFlashFile({ msgtype: "m.file", body: "game.zip", url: "mxc://example.org/a" })).toBe(false);
        expect(isFlashFile({ msgtype: "m.image", body: "game.swf", url: "mxc://example.org/a" })).toBe(false);
        expect(isFlashFile({ msgtype: "m.file", body: "game.swf" })).toBe(false);
    });

    it("plays Flash only in a build with Ruffle", async () => {
        const content = { msgtype: "m.file", body: "game.swf", url: "mxc://example.org/a" };
        expect((await load()).isGameFile(content)).toBe(true);
        vi.stubEnv("HAVEN_RUFFLE", "");
        expect((await load()).isGameFile(content)).toBe(false);
        expect((await load()).isGameFile({ ...content, body: "chess.xdc" })).toBe(true);
    });

    it("packages a movie with Ruffle and a page to play it", async () => {
        serveRuffle({ "ruffle.js": "ruffle", "core.ruffle.1.js": "core", "a.wasm": "wasm" });
        const { readFlashArchive } = await load();
        const archive = await readFlashArchive(movie(), "Toss the Turtle");

        expect(archive.manifest).toEqual({ name: "Toss the Turtle" });
        expect(archive.saveKey).toMatch(/^[0-9a-f]{32}$/);
        expect(archive.files.map(([name, , type]) => [name, type])).toEqual([
            ["index.html", "text/html"],
            ["ruffle.js", "text/javascript"],
            ["core.ruffle.1.js", "text/javascript"],
            ["a.wasm", "application/wasm"],
            ["movie.swf", "application/x-shockwave-flash"],
        ]);
        const page = new TextDecoder().decode(archive.files[0][1]);
        expect(page).toContain('"allowNetworking":"none"');
        expect(page).toContain('url: "movie.swf"');
        expect(page).toContain("<title>Toss the Turtle</title>");
    });

    it("keeps the same save for the same movie", async () => {
        serveRuffle({ "ruffle.js": "ruffle", "a.wasm": "wasm" });
        const { readFlashArchive } = await load();
        const first = await readFlashArchive(movie(), "One");
        const again = await readFlashArchive(movie(), "Another name");
        const other = await readFlashArchive(movie("FWS"), "One");
        expect(again.saveKey).toBe(first.saveKey);
        expect(other.saveKey).not.toBe(first.saveKey);
    });

    it("refuses a file that isn't a Flash movie", async () => {
        serveRuffle({ "ruffle.js": "ruffle", "a.wasm": "wasm" });
        const { readFlashArchive } = await load();
        // The copy of the module the fresh flash.ts uses.
        const { WebxdcArchiveError } = await import("./webxdc");
        await expect(readFlashArchive(new Blob(["PK\u0003\u0004"]), "zip")).rejects.toThrow(WebxdcArchiveError);
    });

    it("says when Ruffle couldn't be loaded, and tries again next time", async () => {
        serveRuffle(null);
        const flash = await load();
        await expect(flash.readFlashArchive(movie(), "Game")).rejects.toThrow(flash.FlashPlayerError);
        serveRuffle({ "ruffle.js": "ruffle", "a.wasm": "wasm" });
        await expect(flash.readFlashArchive(movie(), "Game")).resolves.toMatchObject({ manifest: { name: "Game" } });
    });

    it("escapes the movie's name in the page", async () => {
        serveRuffle({ "ruffle.js": "ruffle", "a.wasm": "wasm" });
        const { readFlashArchive } = await load();
        const archive = await readFlashArchive(movie(), "</title><script>alert(1)</script>");
        const page = new TextDecoder().decode(archive.files[0][1]);
        expect(page).not.toContain("<script>alert(1)</script>");
    });
});

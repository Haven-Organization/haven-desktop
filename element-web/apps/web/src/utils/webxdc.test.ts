/*
 * Haven: tests for webxdc game files.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import JSZip from "jszip";

import SdkConfig from "../SdkConfig";
import {
    cleanWebxdcSave,
    isWebxdcFile,
    loadWebxdcSave,
    storeWebxdcSave,
    parseWebxdcManifest,
    readWebxdcArchive,
    readWebxdcCover,
    WebxdcArchiveError,
    webxdcGameId,
    webxdcMimeType,
    webxdcSandbox,
} from "./webxdc";

async function zipOf(files: Record<string, string>): Promise<Blob> {
    const zip = new JSZip();
    for (const [name, text] of Object.entries(files)) zip.file(name, text);
    return zip.generateAsync({ type: "blob" });
}

describe("isWebxdcFile", () => {
    it.each([
        { msgtype: "m.file", body: "chess.xdc", url: "mxc://example.org/a" },
        {
            msgtype: "m.file",
            body: "a caption",
            filename: "Chess.XDC",
            url: "mxc://example.org/a",
        },
        {
            msgtype: "m.file",
            body: "game",
            url: "mxc://example.org/a",
            info: { mimetype: "application/x-webxdc" },
        },
        {
            msgtype: "m.file",
            body: "game",
            file: { url: "mxc://example.org/a" },
            info: { mimetype: "application/webxdc+zip" },
        },
    ])("recognizes %o", (content) => {
        expect(isWebxdcFile(content)).toBe(true);
    });

    it.each([
        { msgtype: "m.file", body: "notes.zip", url: "mxc://example.org/a" },
        { msgtype: "m.image", body: "chess.xdc", url: "mxc://example.org/a" },
        { msgtype: "m.text", body: "chess.xdc" },
        undefined,
    ])("ignores %o", (content) => {
        expect(isWebxdcFile(content)).toBe(false);
    });
});

describe("parseWebxdcManifest", () => {
    it("reads the name and source link", () => {
        expect(
            parseWebxdcManifest("name = \"Chess \\u2654\"\nsource_code_url = 'https://example.org/chess'\n"),
        ).toEqual({
            name: "Chess ♔",
            sourceCodeUrl: "https://example.org/chess",
        });
    });

    it("ignores keys in tables and blank names", () => {
        expect(parseWebxdcManifest('name = " "\n[extra]\nname = "Other"')).toEqual({});
    });
});

describe("webxdcGameId", () => {
    it("is the same for the same game and safe as a hostname", async () => {
        const id = await webxdcGameId("!room:example.org", "$event");
        expect(id).toMatch(/^[0-9a-f]{32}$/);
        expect(await webxdcGameId("!room:example.org", "$event")).toBe(id);
        expect(await webxdcGameId("!room:example.org", "$other")).not.toBe(id);
    });
});

describe("webxdcSandbox", () => {
    afterEach(() => {
        delete (window as { electron?: unknown }).electron;
        SdkConfig.reset();
    });

    it("uses the desktop app's own sandbox", () => {
        (window as { electron?: unknown }).electron = {};
        expect(webxdcSandbox("abc")).toEqual({
            base: "webxdc://abc/",
            page: "webxdc://abc/loader.html",
            origin: "webxdc://abc",
            bundled: false,
        });
    });

    it("uses the configured sandbox, with the game's id in it", () => {
        SdkConfig.put({
            haven: { webxdc_sandbox_url: "https://{id}.games.example.org/sandbox" },
        } as unknown as Parameters<typeof SdkConfig.put>[0]);
        expect(webxdcSandbox("abc")).toEqual({
            base: "https://abc.games.example.org/sandbox/",
            page: "https://abc.games.example.org/sandbox/loader.html",
            origin: "https://abc.games.example.org",
            bundled: false,
        });
    });

    it("uses the bundled sandbox without one configured, or with one on Haven's own origin", () => {
        const bundled = {
            base: new URL("webxdc-sandbox/game/", window.location.href).href,
            page: new URL("webxdc-sandbox/game/index.html", window.location.href).href,
            origin: "null",
            bundled: true,
        };
        expect(webxdcSandbox("abc")).toEqual(bundled);
        SdkConfig.put({
            haven: { webxdc_sandbox_url: `${window.location.origin}/sandbox/` },
        } as unknown as Parameters<typeof SdkConfig.put>[0]);
        expect(webxdcSandbox("abc")).toEqual(bundled);
    });
});

describe("webxdcMimeType", () => {
    it.each([
        ["index.html", "text/html; charset=utf-8"],
        ["js/app.JS", "text/javascript; charset=utf-8"],
        ["game.wasm", "application/wasm"],
        ["data.bin", "application/octet-stream"],
    ])("%s is %s", (name, type) => {
        expect(webxdcMimeType(name)).toBe(type);
    });
});

describe("readWebxdcArchive", () => {
    it("unpacks a game with its manifest and icon", async () => {
        const archive = await readWebxdcArchive(
            await zipOf({
                "index.html": "<p>hi</p>",
                "manifest.toml": 'name = "Hello"',
                "icon.png": "png",
            }),
        );
        expect(archive.manifest.name).toBe("Hello");
        expect(archive.icon?.type).toBe("image/png");
        expect(archive.files.map(([name]) => name).sort()).toEqual(["icon.png", "index.html", "manifest.toml"]);
    });

    it("opens a game zipped inside a folder", async () => {
        const archive = await readWebxdcArchive(await zipOf({ "hello/index.html": "<p>hi</p>", "hello/a.js": "" }));
        expect(archive.files.map(([name]) => name).sort()).toEqual(["a.js", "index.html"]);
    });

    it("refuses a zip with no index.html", async () => {
        await expect(readWebxdcArchive(await zipOf({ "readme.txt": "" }))).rejects.toBeInstanceOf(WebxdcArchiveError);
    });

    it("refuses a file that isn't a zip", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        await expect(readWebxdcArchive(new Blob(["not a zip"]))).rejects.toBeInstanceOf(WebxdcArchiveError);
    });
});

describe("readWebxdcCover", () => {
    async function bigGame(options: { compression: "DEFLATE" | "STORE"; folder?: string }): Promise<ArrayBuffer> {
        const zip = new JSZip();
        const at = options.folder ? `${options.folder}/` : "";
        // Random, so it doesn't compress: the cover shouldn't need any of it.
        const padding = new Uint8Array(3 * 1024 * 1024);
        for (let i = 0; i < padding.length; i += 65536) crypto.getRandomValues(padding.subarray(i, i + 65536));
        zip.file(`${at}data.bin`, padding);
        zip.file(`${at}index.html`, "<p>hi</p>");
        zip.file(`${at}manifest.toml`, 'name = "Toss the Turtle"');
        zip.file(`${at}icon.png`, "png bytes");
        return zip.generateAsync({ type: "arraybuffer", compression: options.compression });
    }

    function fetcherFor(file: ArrayBuffer) {
        const fetched = { bytes: 0 };
        const fetchRange = async (start: number, end: number): Promise<ArrayBuffer> => {
            fetched.bytes += end - start;
            return file.slice(start, end);
        };
        return { fetchRange, fetched };
    }

    it.each(["DEFLATE", "STORE"] as const)(
        "reads the name and icon of a %s zip, fetching little of it",
        async (compression) => {
            const file = await bigGame({ compression });
            const { fetchRange, fetched } = fetcherFor(file);
            const cover = await readWebxdcCover(fetchRange, file.byteLength);
            expect(cover?.manifest.name).toBe("Toss the Turtle");
            expect(await cover?.icon?.text()).toBe("png bytes");
            expect(cover?.icon?.type).toBe("image/png");
            expect(fetched.bytes).toBeLessThan(file.byteLength / 10);
        },
    );

    it("reads a game zipped inside a folder", async () => {
        const file = await bigGame({ compression: "DEFLATE", folder: "turtle" });
        const cover = await readWebxdcCover(fetcherFor(file).fetchRange, file.byteLength);
        expect(cover?.manifest.name).toBe("Toss the Turtle");
    });

    it("gives up when the server won't send part of a file", async () => {
        expect(await readWebxdcCover(async () => null, 10_000_000)).toBeNull();
    });

    it("gives up on a file that isn't a zip", async () => {
        const file = new TextEncoder().encode("not a zip at all").buffer as ArrayBuffer;
        expect(await readWebxdcCover(fetcherFor(file).fetchRange, file.byteLength)).toBeNull();
    });
});

describe("saves", () => {
    function saveClient(accountData?: Record<string, unknown>) {
        return {
            getAccountData: vi.fn(() => (accountData ? { getContent: () => accountData } : undefined)),
            setAccountData: vi.fn().mockResolvedValue({}),
            uploadContent: vi.fn().mockResolvedValue({ content_uri: "mxc://example.org/save" }),
            mxcUrlToHttp: vi.fn((mxc: string) => `https://example.org/media/${mxc.slice(6)}`),
        } as unknown as MatrixClient;
    }

    it("keeps only strings, as localStorage does", () => {
        expect(cleanWebxdcSave({ a: "1", b: 2, c: null })).toEqual({ a: "1" });
        expect(cleanWebxdcSave(["a"])).toBeNull();
        expect(cleanWebxdcSave("save")).toBeNull();
    });

    it("keeps a small save in account data", async () => {
        const client = saveClient();
        expect(await storeWebxdcSave(client, "abc", { level: "3" })).toBe(true);
        expect(client.setAccountData).toHaveBeenCalledWith(
            "software.haven.webxdc.save.abc",
            expect.objectContaining({ data: { level: "3" }, updated: expect.any(Number) }),
        );
        expect(client.uploadContent).not.toHaveBeenCalled();
    });

    it("uploads a big save and keeps a link to it", async () => {
        const client = saveClient();
        await storeWebxdcSave(client, "abc", { world: "x".repeat(40_000) });
        expect(client.uploadContent).toHaveBeenCalled();
        expect(client.setAccountData).toHaveBeenCalledWith(
            "software.haven.webxdc.save.abc",
            expect.objectContaining({ url: "mxc://example.org/save" }),
        );
    });

    it("refuses a save bigger than localStorage holds", async () => {
        const client = saveClient();
        expect(await storeWebxdcSave(client, "abc", { world: "x".repeat(6 * 1024 * 1024) })).toBe(false);
        expect(client.setAccountData).not.toHaveBeenCalled();
    });

    it("reads a save back, from account data or its file", async () => {
        expect(await loadWebxdcSave(saveClient({ data: { level: "3" }, updated: 5 }), "abc")).toEqual({
            data: { level: "3" },
            updated: 5,
        });
        expect(await loadWebxdcSave(saveClient(), "abc")).toBeNull();

        vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ level: "9" })));
        expect(await loadWebxdcSave(saveClient({ url: "mxc://example.org/save", updated: 6 }), "abc")).toEqual({
            data: { level: "9" },
            updated: 6,
        });
        vi.mocked(globalThis.fetch).mockRestore();
    });

    it("gives every game a save key from its file", async () => {
        const one = await readWebxdcArchive(await zipOf({ "index.html": "one" }));
        const again = await readWebxdcArchive(await zipOf({ "index.html": "one" }));
        expect(one.saveKey).toMatch(/^[0-9a-f]{32}$/);
        expect(again.saveKey).toBe(one.saveKey);
    });
});

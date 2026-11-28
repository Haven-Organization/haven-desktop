// @vitest-environment happy-dom
// Haven: the device cache of game apps' files - what's cached, the limits, and forgetting games.
import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MatrixEvent } from "matrix-js-sdk/src/matrix";

const { downloads } = vi.hoisted(() => ({ downloads: { count: 0, bytes: new Map<string, Uint8Array>() } }));
vi.mock("../../../../element-web/apps/web/src/customisations/Media", () => ({
    mediaFromContent: (content: { url?: string; file?: { url: string } }) => {
        const mxc = content.file?.url ?? content.url ?? "";
        return {
            srcMxc: mxc,
            downloadSource: async () => {
                downloads.count++;
                const bytes = downloads.bytes.get(mxc);
                return bytes ? new Response(new Blob([bytes as BlobPart])) : new Response("", { status: 404 });
            },
        };
    },
}));

import {
    cachedBytes,
    clearGameFileCache,
    filesToEvict,
    forgetGameApps,
    getCachedGameFile,
    listCachedFiles,
    MAX_FILE_BYTES,
    pruneGameFileCache,
} from "./gameFileCache";

function gameEvent(mxc: string): MatrixEvent {
    return new MatrixEvent({
        type: "m.room.message",
        room_id: "!r:example.org",
        event_id: "$e",
        content: { msgtype: "m.file", body: "game.xdc", url: mxc, info: { mimetype: "application/x-webxdc" } },
    });
}

const notCalled = async (): Promise<Blob> => {
    throw new Error("the stock download shouldn't be needed");
};

/** Waits for the cache write that follows a download, which isn't awaited. */
async function settle(): Promise<void> {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("game file cache", () => {
    beforeEach(async () => {
        await clearGameFileCache();
        downloads.count = 0;
        downloads.bytes.clear();
        downloads.bytes.set("mxc://example.org/small", new Uint8Array([1, 2, 3]));
    });

    it("downloads a game once, then opens it from the cache", async () => {
        const first = await getCachedGameFile(gameEvent("mxc://example.org/small"), "game:a", notCalled);
        await settle();
        const second = await getCachedGameFile(gameEvent("mxc://example.org/small"), "game:a", notCalled);
        expect(downloads.count).toBe(1);
        expect(new Uint8Array(await second.arrayBuffer())).toEqual(new Uint8Array(await first.arrayBuffer()));
        expect(await cachedBytes()).toBe(3);
    });

    it("doesn't cache a file over the size limit", async () => {
        downloads.bytes.set("mxc://example.org/big", new Uint8Array(MAX_FILE_BYTES + 1));
        await getCachedGameFile(gameEvent("mxc://example.org/big"), "game:big", notCalled);
        await settle();
        expect(await listCachedFiles()).toEqual([]);
    });

    it("uses the stock download when the server won't send the file", async () => {
        const stock = vi.fn(async () => new Blob(["x"]));
        await getCachedGameFile(gameEvent("mxc://example.org/missing"), "game:x", stock);
        expect(stock).toHaveBeenCalled();
    });

    it("drops a file once no game app uses it", async () => {
        await getCachedGameFile(gameEvent("mxc://example.org/small"), "game:a", notCalled);
        await settle();
        await getCachedGameFile(gameEvent("mxc://example.org/small"), "game:b", notCalled);
        await forgetGameApps(["game:a"]);
        expect((await listCachedFiles())[0].appIds).toEqual(["game:b"]);
        await pruneGameFileCache([]);
        expect(await listCachedFiles()).toEqual([]);
    });

    it("evicts the games played longest ago first", () => {
        const metas = [
            { mxc: "old", size: 100, lastUsed: 1, appIds: [] },
            { mxc: "new", size: 100, lastUsed: 3, appIds: [] },
            { mxc: "mid", size: 100, lastUsed: 2, appIds: [] },
        ];
        expect(filesToEvict(metas, 300)).toEqual([]);
        expect(filesToEvict(metas, 150)).toEqual(["old", "mid"]);
    });
});

/*
 * Haven: tests for the IndexedDB the bundled webxdc sandbox gives games.
 */

// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

import { decode, encode, install, restore, snapshot } from "./indexeddb";

function done<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/** A game's database: scores with an index, and settings with out-of-line keys. */
async function fill(factory: IDBFactory): Promise<void> {
    const request = factory.open("game", 3);
    request.onupgradeneeded = () => {
        const db = request.result;
        const scores = db.createObjectStore("scores", { keyPath: "id", autoIncrement: true });
        scores.createIndex("by-player", "player", { unique: false });
        db.createObjectStore("settings");
    };
    const db = await done(request);
    const tx = db.transaction(["scores", "settings"], "readwrite");
    tx.objectStore("scores").add({ player: "alice", points: 10 });
    tx.objectStore("scores").add({ player: "bob", points: 7, when: new Date(5) });
    tx.objectStore("settings").put(new Map([["volume", 0.5]]), "audio");
    tx.objectStore("settings").put(new Uint8Array([1, 2, 3]), ["level", 2]);
    await new Promise((resolve) => (tx.oncomplete = resolve));
    db.close();
}

describe("the sandbox's IndexedDB", () => {
    it("keeps values JSON can't hold", async () => {
        const value = {
            date: new Date(1000),
            nothing: undefined,
            big: 10n,
            odd: [NaN, -0, Infinity],
            bytes: new Uint16Array([1, 65535]),
            buffer: new Uint8Array([9]).buffer,
            map: new Map<unknown, unknown>([[1, new Set(["a"])]]),
            pattern: /x+/gi,
            blob: new Blob(["hi"], { type: "text/plain" }),
            $: "looks like a tag",
        };
        const copy = decode(JSON.parse(JSON.stringify(await encode(value)))) as typeof value;
        expect(copy.date).toEqual(new Date(1000));
        expect("nothing" in copy && copy.nothing === undefined).toBe(true);
        expect(copy.big).toBe(10n);
        expect(copy.odd[0]).toBeNaN();
        expect(Object.is(copy.odd[1], -0)).toBe(true);
        expect(copy.odd[2]).toBe(Infinity);
        expect(copy.bytes).toEqual(new Uint16Array([1, 65535]));
        expect(new Uint8Array(copy.buffer)).toEqual(new Uint8Array([9]));
        expect(copy.map.get(1)).toEqual(new Set(["a"]));
        expect(copy.pattern).toEqual(/x+/gi);
        expect(await copy.blob.text()).toBe("hi");
        expect(copy.blob.type).toBe("text/plain");
        expect(copy.$).toBe("looks like a tag");
    });

    it("copies a game's databases and puts them back", async () => {
        const before = new IDBFactory();
        await fill(before);
        const saved = JSON.parse(JSON.stringify(await snapshot(before)));

        const after = new IDBFactory();
        await restore(after, saved);
        const db = await done(after.open("game"));
        expect(db.version).toBe(3);
        const tx = db.transaction(["scores", "settings"], "readwrite");
        const scores = tx.objectStore("scores");
        expect(await done(scores.index("by-player").get("bob"))).toEqual({
            id: 2,
            player: "bob",
            points: 7,
            when: new Date(5),
        });
        expect(await done(tx.objectStore("settings").get("audio"))).toEqual(new Map([["volume", 0.5]]));
        expect(await done(tx.objectStore("settings").get(["level", 2]))).toEqual(new Uint8Array([1, 2, 3]));
        // New records carry on from the saved ones' keys.
        expect(await done(scores.add({ player: "carol", points: 1 }))).toBe(3);
        db.close();
    });

    it("gives the game an IndexedDB from its save, and writes changes back into it", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        try {
            const old = new IDBFactory();
            await fill(old);
            const keep = vi.fn();
            const win = window as Window & typeof globalThis;
            await install({ win, saved: JSON.stringify(await snapshot(old)), keep });

            const db = await done(win.indexedDB.open("game"));
            const tx = db.transaction("scores", "readwrite");
            expect(await done(tx.objectStore("scores").count())).toBe(2);
            tx.objectStore("scores").add({ player: "dave", points: 3 });
            await new Promise((resolve) => (tx.oncomplete = resolve));
            db.close();
            expect(keep).not.toHaveBeenCalled();

            // Haven asks for the save before the delay is up: it waits for the copy.
            const waits: Promise<unknown>[] = [];
            win.dispatchEvent(
                new CustomEvent("xdc-save", { detail: { wait: (p: Promise<unknown>) => waits.push(p) } }),
            );
            expect(waits).toHaveLength(1);
            await Promise.all(waits);
            expect(keep).toHaveBeenCalledTimes(1);
            const kept = JSON.parse(keep.mock.calls[0][0]);
            expect(kept.dbs[0].stores.find((s: { name: string }) => s.name === "scores").values).toHaveLength(3);
        } finally {
            vi.useRealTimers();
        }
    });

    it("lets a game open and delete a database of its own", async () => {
        const keep = vi.fn();
        const win = window as Window & typeof globalThis;
        await install({ win, saved: null, keep });
        const db = await done(win.indexedDB.open("fresh", 1));
        db.close();
        await done(win.indexedDB.deleteDatabase("fresh"));
        await vi.waitFor(() => expect(keep).toHaveBeenCalled());
        expect(JSON.parse(keep.mock.lastCall![0])).toEqual({ v: 1, dbs: [] });
    });
});

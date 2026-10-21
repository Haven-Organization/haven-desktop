/*
Copyright 2026 Haven contributors

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom
// connect() starts a flush timer through window.setInterval.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, it, expect, vi } from "vitest";

import { ConsoleLogger, IndexedDBLogStore } from "./rageshake";

/** A connected store on `factory` that has flushed one log chunk of its own. */
async function storeWithLog(factory: IDBFactory, text: string): Promise<IndexedDBLogStore> {
    const logger = { flush: () => text } as unknown as ConsoleLogger;
    const store = new IndexedDBLogStore(factory, logger);
    await store.connect();
    await store.flush();
    return store;
}

describe("ConsoleLogger", () => {
    it("keeps ordinary lines whole", () => {
        const logger = new ConsoleLogger();
        logger.log("I", "hello", { a: 1 });
        expect(logger.flush()).toMatch(/ I hello \{"a":1\}\n$/);
    });

    it("cuts a huge line down to its start", () => {
        const logger = new ConsoleLogger();
        logger.log("I", { big: "x".repeat(1024 * 1024) });
        const line = logger.flush();
        expect(line.length).toBeLessThan(20 * 1024);
        expect(line).toMatch(/\{"big":"xxx/);
        expect(line).toMatch(/ \[truncated \d+ KB\]\n$/);
    });
});

describe("IndexedDBLogStore.prune", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("keeps only the newest five instances' logs", async () => {
        const factory = new IDBFactory();
        const stores: IndexedDBLogStore[] = [];
        for (let i = 0; i < 7; i++) {
            vi.spyOn(Date, "now").mockReturnValue(1_000_000 + i * 1000);
            stores.push(await storeWithLog(factory, `log ${i}\n`));
        }
        vi.spyOn(Date, "now").mockReturnValue(1_000_000 + 10_000);

        await stores[6].prune();

        const kept = (await stores[6].consume()).map((l) => l.lines);
        expect(kept).toHaveLength(5);
        for (let i = 2; i < 7; i++) expect(kept.some((l) => l.endsWith(`log ${i}\n`))).toBe(true);
    });

    it("drops logs not written in the last 24 hours", async () => {
        const factory = new IDBFactory();
        vi.spyOn(Date, "now").mockReturnValue(1_000_000);
        await storeWithLog(factory, "old\n");
        const day = 24 * 3600 * 1000;
        vi.spyOn(Date, "now").mockReturnValue(1_000_000 + day + 1000);
        const current = await storeWithLog(factory, "new\n");

        await current.prune();

        const kept = (await current.consume()).map((l) => l.lines);
        expect(kept).toHaveLength(1);
        expect(kept[0]).toMatch(/new\n$/);
    });
});

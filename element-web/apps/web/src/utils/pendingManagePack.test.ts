import { describe, it, expect, beforeEach } from "vitest";

import { setPendingManagePackStateKey, consumePendingManagePackStateKey } from "./pendingManagePack";

// Haven: regression coverage for the "open Room Settings' Emoji & Stickers tab with this exact
// pack's own editor already open" bridge - a set value must be consumed exactly once (destructive
// read), and consuming with nothing pending must return null rather than throwing.
describe("pendingManagePack", () => {
    beforeEach(() => {
        // Drain any state left over from a previous test - the module holds a single shared
        // in-memory slot, not per-test state.
        consumePendingManagePackStateKey();
    });

    it("returns null when nothing is pending", () => {
        expect(consumePendingManagePackStateKey()).toBeNull();
    });

    it("returns the set state key on first consume", () => {
        setPendingManagePackStateKey("my-pack");
        expect(consumePendingManagePackStateKey()).toBe("my-pack");
    });

    it("clears the value after consuming it - a second consume returns null", () => {
        setPendingManagePackStateKey("my-pack");
        consumePendingManagePackStateKey();
        expect(consumePendingManagePackStateKey()).toBeNull();
    });

    it("a later set overwrites an earlier unconsumed one", () => {
        setPendingManagePackStateKey("first-pack");
        setPendingManagePackStateKey("second-pack");
        expect(consumePendingManagePackStateKey()).toBe("second-pack");
    });
});

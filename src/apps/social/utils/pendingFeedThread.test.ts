import { describe, it, expect } from "vitest";

import { setPendingFeedThread, consumePendingFeedThread } from "./pendingFeedThread";

describe("pendingFeedThread", () => {
    it("has nothing pending until set", () => {
        expect(consumePendingFeedThread()).toBeNull();
    });

    it("returns what was set", () => {
        setPendingFeedThread("!room:example.org", "$event");
        expect(consumePendingFeedThread()).toEqual({ roomId: "!room:example.org", eventId: "$event" });
    });

    it("consumes destructively - a second read after the first gets nothing", () => {
        setPendingFeedThread("!room:example.org", "$event");
        expect(consumePendingFeedThread()).not.toBeNull();
        expect(consumePendingFeedThread()).toBeNull();
    });

    it("a later set overwrites an earlier, not-yet-consumed one", () => {
        setPendingFeedThread("!first:example.org", "$first");
        setPendingFeedThread("!second:example.org", "$second");
        expect(consumePendingFeedThread()).toEqual({ roomId: "!second:example.org", eventId: "$second" });
    });
});

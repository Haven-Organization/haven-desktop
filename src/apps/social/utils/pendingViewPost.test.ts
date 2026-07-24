import { describe, it, expect } from "vitest";

import { setPendingViewPost, consumePendingViewPost } from "./pendingViewPost";

describe("pendingViewPost", () => {
    it("has nothing pending until set", () => {
        expect(consumePendingViewPost()).toBeNull();
    });

    it("returns what was set, with eventId", () => {
        setPendingViewPost("!room:example.org", "$event");
        expect(consumePendingViewPost()).toEqual({ roomId: "!room:example.org", eventId: "$event" });
    });

    it("returns what was set, with eventId omitted", () => {
        setPendingViewPost("!room:example.org");
        expect(consumePendingViewPost()).toEqual({ roomId: "!room:example.org", eventId: undefined });
    });

    it("consumes destructively - a second read after the first gets nothing", () => {
        setPendingViewPost("!room:example.org", "$event");
        expect(consumePendingViewPost()).not.toBeNull();
        expect(consumePendingViewPost()).toBeNull();
    });

    it("a later set overwrites an earlier, not-yet-consumed one", () => {
        setPendingViewPost("!first:example.org", "$first");
        setPendingViewPost("!second:example.org", "$second");
        expect(consumePendingViewPost()).toEqual({ roomId: "!second:example.org", eventId: "$second" });
    });
});

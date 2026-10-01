/*
 * Social Overlay - feedFirstItemIndex tests
 *
 * Regression coverage for "pressing Repost in the Feed scrolls it a little": a post arriving at
 * the top has to lower Virtuoso's firstItemIndex by exactly the number of posts added above the
 * previous first one, or Virtuoso misattributes its measured heights.
 */

import { describe, it, expect } from "vitest";

import { nextFirstItemIndex, type FirstItemIndexState } from "./feedFirstItemIndex";

const FILTER = { name: "filter" };
const BASE = 1_000_000;

function start(firstKey: string | undefined, filter: object = FILTER): FirstItemIndexState<object> {
    return { firstKey, filter, index: BASE };
}

describe("nextFirstItemIndex", () => {
    it("lowers the index by one when a single post arrives on top (e.g. your own repost)", () => {
        const next = nextFirstItemIndex(start("$a"), ["$repost", "$a", "$b"], FILTER);
        expect(next).toEqual({ firstKey: "$repost", filter: FILTER, index: BASE - 1 });
    });

    it("lowers the index by the number of posts that arrived on top", () => {
        const next = nextFirstItemIndex(start("$a"), ["$new1", "$new2", "$new3", "$a"], FILTER);
        expect(next.index).toBe(BASE - 3);
    });

    it("is unchanged when only posts further down changed (e.g. backfill appended)", () => {
        const previous = start("$a");
        expect(nextFirstItemIndex(previous, ["$a", "$b", "$older"], FILTER)).toBe(previous);
    });

    it("returns the same state when evaluated again for the same list", () => {
        const once = nextFirstItemIndex(start("$a"), ["$new", "$a"], FILTER);
        const twice = nextFirstItemIndex(once, ["$new", "$a"], FILTER);
        expect(twice).toBe(once);
        expect(twice.index).toBe(BASE - 1);
    });

    it("leaves the index alone when the filter changed", () => {
        const otherFilter = { name: "other" };
        const next = nextFirstItemIndex(start("$a"), ["$x", "$y", "$a"], otherFilter);
        expect(next).toEqual({ firstKey: "$x", filter: otherFilter, index: BASE });
    });

    it("leaves the index alone when the previous first post is gone (e.g. redacted)", () => {
        const next = nextFirstItemIndex(start("$a"), ["$b", "$c"], FILTER);
        expect(next.index).toBe(BASE);
        expect(next.firstKey).toBe("$b");
    });

    it("starts tracking without adjusting on the first non-empty list", () => {
        const next = nextFirstItemIndex(start(undefined), ["$a", "$b"], FILTER);
        expect(next).toEqual({ firstKey: "$a", filter: FILTER, index: BASE });
    });
});

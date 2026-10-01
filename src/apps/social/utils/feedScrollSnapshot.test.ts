/*
 * Social Overlay - feedScrollSnapshot tests
 *
 * Back from a post has to land on the same post even when the Feed changed above it while the
 * post was open - see feedScrollSnapshot.ts.
 */

import { describe, it, expect } from "vitest";
import { type StateSnapshot } from "react-virtuoso";

import { adjustFeedSnapshot } from "./feedScrollSnapshot";

const ids = (...names: string[]): string[] => names.map((n) => `$${n}`);

// Posts a..e measured at 100, 200, 300, 400, 500px; f onwards not measured (last open range).
const RANGES = [
    { startIndex: 0, endIndex: 0, size: 100 },
    { startIndex: 1, endIndex: 1, size: 200 },
    { startIndex: 2, endIndex: 2, size: 300 },
    { startIndex: 3, endIndex: 3, size: 400 },
    { startIndex: 4, endIndex: Infinity, size: 500 },
];
const OLD_IDS = ids("a", "b", "c", "d", "e", "f");

/** Offset of post `c` (index 2) is 100 + 200 = 300; 50px into it. */
const SNAPSHOT: StateSnapshot = { ranges: RANGES, scrollTop: 350 };

/** What a restored list would put at the top of the viewport, and how far into it. */
function topOf(snapshot: StateSnapshot, postIds: string[]): { id: string; into: number } {
    let offset = 0;
    for (let i = 0; i < postIds.length; i++) {
        const range = snapshot.ranges.find((r) => r.startIndex <= i && i <= r.endIndex)!;
        if (snapshot.scrollTop < offset + range.size) return { id: postIds[i], into: snapshot.scrollTop - offset };
        offset += range.size;
    }
    throw new Error("past the end");
}

describe("adjustFeedSnapshot", () => {
    it("is unchanged when the list didn't change above the viewer", () => {
        const saved = { snapshot: SNAPSHOT, postIds: OLD_IDS };
        expect(adjustFeedSnapshot(saved, [...OLD_IDS, "$older"])).toBe(SNAPSHOT);
    });

    it("lands on the same post after a new post arrived on top while away", () => {
        const current = ids("new", "a", "b", "c", "d", "e", "f");
        const adjusted = adjustFeedSnapshot({ snapshot: SNAPSHOT, postIds: OLD_IDS }, current);
        expect(topOf(adjusted, current)).toEqual({ id: "$c", into: 50 });
    });

    it("keeps each existing post's measured height attached to that post", () => {
        const current = ids("new1", "new2", "a", "b", "c", "d", "e", "f");
        const adjusted = adjustFeedSnapshot({ snapshot: SNAPSHOT, postIds: OLD_IDS }, current);
        const sizeAt = (i: number): number => adjusted.ranges.find((r) => r.startIndex <= i && i <= r.endIndex)!.size;
        expect(sizeAt(current.indexOf("$a"))).toBe(100);
        expect(sizeAt(current.indexOf("$c"))).toBe(300);
        expect(sizeAt(current.indexOf("$d"))).toBe(400);
    });

    it("lands on the same post after several new posts arrived on top", () => {
        const current = ids("n1", "n2", "n3", "a", "b", "c", "d", "e", "f");
        const adjusted = adjustFeedSnapshot({ snapshot: SNAPSHOT, postIds: OLD_IDS }, current);
        expect(topOf(adjusted, current)).toEqual({ id: "$c", into: 50 });
    });

    it("lands on the same post after a post above it was removed while away", () => {
        const current = ids("b", "c", "d", "e", "f");
        const adjusted = adjustFeedSnapshot({ snapshot: SNAPSHOT, postIds: OLD_IDS }, current);
        expect(topOf(adjusted, current)).toEqual({ id: "$c", into: 50 });
    });

    it("lands on the same post after posts were inserted above it further down (not at the top)", () => {
        const current = ids("a", "b", "inserted", "c", "d", "e", "f");
        const adjusted = adjustFeedSnapshot({ snapshot: SNAPSHOT, postIds: OLD_IDS }, current);
        expect(topOf(adjusted, current).id).toBe("$c");
    });

    it("falls back to the plain snapshot when the post on screen was removed", () => {
        const saved = { snapshot: SNAPSHOT, postIds: OLD_IDS };
        expect(adjustFeedSnapshot(saved, ids("a", "b", "d", "e", "f"))).toBe(SNAPSHOT);
    });

    it("returns an empty snapshot unchanged", () => {
        const empty: StateSnapshot = { ranges: [], scrollTop: 0 };
        expect(adjustFeedSnapshot({ snapshot: empty, postIds: [] }, ids("a"))).toBe(empty);
    });
});

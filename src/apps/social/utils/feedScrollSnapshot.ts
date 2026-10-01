/*
 * Social Overlay - feedScrollSnapshot
 *
 * Adjusts a saved Feed scroll snapshot (react-virtuoso's StateSnapshot) for posts that were added
 * or removed above the viewer's position while the list wasn't mounted - i.e. while a post was
 * open in the thread view.
 *
 * A snapshot records measured heights by *position* in the list (0-based) plus a scroll offset
 * from the top of the list. Virtuoso only renumbers those when it's told about a prepend while
 * it's mounted (firstItemIndex - see FeedPane in SocialHomeView.tsx). While a post is open the
 * Feed's list is unmounted, so a new post landing on top during that visit (common on a busy
 * feed) would leave Back restoring heights attributed to the wrong posts and an offset short by
 * the new post's height.
 */

import { type SizeRange, type StateSnapshot } from "react-virtuoso";

/** A snapshot plus the post ids, in order, that the list held when it was taken. */
export interface SavedFeedScroll {
    snapshot: StateSnapshot;
    postIds: readonly (string | undefined)[];
}

/** Total height of items before `index`, per `ranges`. */
function offsetOf(ranges: readonly SizeRange[], index: number): number {
    let offset = 0;
    for (const range of ranges) {
        if (range.startIndex >= index) break;
        if (range.size === 0) continue;
        const lastBefore = Math.min(range.endIndex, index - 1);
        offset += (lastBefore - range.startIndex + 1) * range.size;
    }
    return offset;
}

/** The item at the top of the viewport for a given scroll offset, per `ranges`. */
function indexAt(ranges: readonly SizeRange[], scrollTop: number): number {
    let offset = 0;
    for (const range of ranges) {
        // The last range is open-ended (endIndex Infinity) - Infinity * 0 would be NaN.
        const span = range.size === 0 ? 0 : (range.endIndex - range.startIndex + 1) * range.size;
        if (range.size > 0 && scrollTop < offset + span) {
            return range.startIndex + Math.floor((scrollTop - offset) / range.size);
        }
        offset += span;
    }
    return ranges.length > 0 ? ranges[ranges.length - 1].startIndex : 0;
}

/** Moves every range by `shift` positions. A positive shift fills the new leading positions with
 *  `fillSize`; a negative one drops the leading positions that no longer exist. */
function shiftRanges(ranges: readonly SizeRange[], shift: number, fillSize: number): SizeRange[] {
    const shifted: SizeRange[] = [];
    if (shift > 0) shifted.push({ startIndex: 0, endIndex: shift - 1, size: fillSize });
    for (const range of ranges) {
        const startIndex = Math.max(0, range.startIndex + shift);
        const endIndex = range.endIndex + shift;
        if (endIndex < startIndex) continue;
        shifted.push({ startIndex, endIndex, size: range.size });
    }
    return shifted;
}

/**
 * Returns `saved.snapshot` adjusted to `currentPostIds`. Finds the post that was at the top of the
 * viewport when the snapshot was taken, works out how many positions it has moved (posts added or
 * removed above it), shifts the measured heights by that much, and moves the scroll offset by the
 * same amount of height so that post lands back exactly where it was.
 *
 * Positions newly added above it get an estimated height (the size of the first measured range).
 * That's fine: the scroll offset is moved by the same estimate, so the post the viewer was on
 * still lines up exactly, and Virtuoso corrects the estimate once a new post is actually drawn.
 *
 * Returned unchanged when nothing moved, or when the top post can't be found in the current list
 * (removed while away) - the plain snapshot is still the best available guess then.
 */
export function adjustFeedSnapshot(
    saved: SavedFeedScroll,
    currentPostIds: readonly (string | undefined)[],
): StateSnapshot {
    const { snapshot, postIds } = saved;
    const { ranges, scrollTop } = snapshot;
    if (ranges.length === 0) return snapshot;

    const anchorOldIndex = Math.min(indexAt(ranges, scrollTop), postIds.length - 1);
    const anchorId = postIds[anchorOldIndex];
    if (anchorId === undefined) return snapshot;
    const anchorNewIndex = currentPostIds.indexOf(anchorId);
    if (anchorNewIndex < 0) return snapshot;

    const shift = anchorNewIndex - anchorOldIndex;
    if (shift === 0) return snapshot;

    const shiftedRanges = shiftRanges(ranges, shift, ranges[0].size);
    const withinAnchor = scrollTop - offsetOf(ranges, anchorOldIndex);
    return {
        ranges: shiftedRanges,
        scrollTop: offsetOf(shiftedRanges, anchorNewIndex) + withinAnchor,
    };
}

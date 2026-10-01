/*
 * Social Overlay - feedFirstItemIndex
 *
 * Tracks the Feed's Virtuoso firstItemIndex across renders - see FeedPane's own doc on it in
 * SocialHomeView.tsx for why posts arriving at the top need it.
 */

/** What was recorded the last time the Feed's list was rendered. */
export interface FirstItemIndexState<F> {
    /** Event id of the post that was first in the list, if any. */
    firstKey: string | undefined;
    /** The filter that list was built with - compared by identity. */
    filter: F;
    /** The firstItemIndex that was used. */
    index: number;
}

/**
 * Works out the firstItemIndex for a new list of post ids. Lowers it by however many posts now sit
 * above the previously-first post. Leaves it unchanged when the previously-first post is gone,
 * when the filter changed (a different list, not posts added on top), or when nothing moved.
 * Calling it again with the state it returned and the same ids returns that same state, so it's
 * safe to evaluate more than once for one render.
 */
export function nextFirstItemIndex<F>(
    previous: FirstItemIndexState<F>,
    postIds: readonly (string | undefined)[],
    filter: F,
): FirstItemIndexState<F> {
    const firstKey = postIds[0];
    if (firstKey === previous.firstKey && filter === previous.filter) return previous;
    let index = previous.index;
    if (previous.firstKey !== undefined && previous.filter === filter) {
        const previousFirstPosition = postIds.indexOf(previous.firstKey);
        if (previousFirstPosition > 0) index -= previousFirstPosition;
    }
    return { firstKey, filter, index };
}

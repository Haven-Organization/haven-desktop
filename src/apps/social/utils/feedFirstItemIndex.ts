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
 *
 * `atTop` (the top of the list is in view) also leaves it unchanged: lowering it makes Virtuoso
 * hold the existing posts in place by scrolling down past the new ones, which is right when the
 * viewer is reading further down but, at the top, scrolled the Feed down away from the new post
 * instead of just showing it - "sitting at the top of my feed, it randomly scrolls down".
 */
export function nextFirstItemIndex<F>(
    previous: FirstItemIndexState<F>,
    postIds: readonly (string | undefined)[],
    filter: F,
    atTop = false,
): FirstItemIndexState<F> {
    const firstKey = postIds[0];
    if (firstKey === previous.firstKey && filter === previous.filter) return previous;
    let index = previous.index;
    if (!atTop && previous.firstKey !== undefined && previous.filter === filter) {
        const previousFirstPosition = postIds.indexOf(previous.firstKey);
        if (previousFirstPosition > 0) index -= previousFirstPosition;
    }
    return { firstKey, filter, index };
}

/*
 * Social Overlay — useLoadMoreSentinel
 *
 * A ref callback for a sentinel element placed at the bottom of a scrollable list. When it
 * scrolls into view, calls `onLoadMore`. Used to grow the visible window of an already-aggregated
 * post list (fast, no network) and, once that's exhausted, to fetch more history from the server —
 * the same "load more as you approach the end" shape as Element's own room timeline pagination,
 * just without needing a single room's TimelinePanel/ScrollPanel machinery.
 */

import { type RefCallback, useCallback, useRef } from "react";

export function useLoadMoreSentinel(onLoadMore: () => void, enabled: boolean): RefCallback<HTMLElement> {
    const observerRef = useRef<IntersectionObserver | null>(null);

    return useCallback(
        (node: HTMLElement | null) => {
            observerRef.current?.disconnect();
            observerRef.current = null;
            if (!node || !enabled) return;

            observerRef.current = new IntersectionObserver((entries) => {
                if (entries[0]?.isIntersecting) onLoadMore();
            });
            observerRef.current.observe(node);
        },
        [onLoadMore, enabled],
    );
}

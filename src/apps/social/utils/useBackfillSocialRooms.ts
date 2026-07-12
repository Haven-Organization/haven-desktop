/*
 * Social Overlay — useBackfillSocialRooms
 *
 * Social rooms are never opened through the normal RoomView/TimelinePanel, so
 * their live timelines only ever hold the handful of events matrix-js-sdk
 * loaded at initial sync — nothing else ever triggers pagination. Without
 * this, the feed only ever shows that first small window of history per
 * room, which looks like random gaps once posts scroll past it.
 *
 * This hook walks every joined room the Feed filter currently counts (see
 * utils/socialFeedFilter.ts's roomCountsForFeed — the built-in Social Rooms types plus whatever
 * extra types/specific rooms the user's filter adds) once, and paginates its live timeline
 * backwards by a small initial number of pages, so the feed has a comfortable buffer of real
 * history without eagerly fetching everything — callers should call `loadMore()` (see below) as
 * the user scrolls, rather than expecting all history to already be loaded.
 *
 * It also calls room.loadMembersIfNeeded(), same as RoomView does before
 * showing a room's timeline. Without it, room.getMember(userId) fails for
 * anyone who hasn't recently posted, which breaks user pill avatars/names
 * (Pill's usePermalinkMember hook, and UserProfilesStore.isUserIdKnown,
 * both depend on membership state being loaded) — even though that same
 * user's pill renders fine in the normal room view, which does load members.
 *
 * The returned generation number increments each time a room finishes both
 * steps. Thread it down as a `pillsGeneration` prop to SocialEventTile (via
 * SocialRoomView/SocialPostView), which uses it to key *just* the small
 * pill-bearing message-body div — not the whole tile — so that div remounts
 * with fresh data instead of staying stuck with whatever `usePermalinkMember`
 * resolved (or failed to resolve) on its original mount, without remounting
 * (and so interrupting) any image/video/audio elsewhere in the same tile.
 */

import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type MatrixClient, type Room, KnownMembership } from "matrix-js-sdk/src/matrix";

import { type SocialFeedFilter, roomCountsForFeed } from "./socialFeedFilter";

const PAGE_SIZE = 100;
const INITIAL_PAGES_PER_ROOM = 2;
const MAX_PAGES_PER_ROOM = 20;
const MEMBER_LOAD_ATTEMPTS = 3;
const MEMBER_LOAD_RETRY_DELAY_MS = 1500;

export interface BackfillState {
    /** Bumped once a room finishes its initial membership load / history fetch. */
    generation: number;
    /** True while at least one joined social room might still have more history to fetch. */
    hasMore: boolean;
    /**
     * Fetches one more page of history (per room that isn't already exhausted or at the page
     * ceiling). Resolves once all in-flight fetches settle. Safe to call repeatedly (e.g. from a
     * scroll-triggered "load more"); no-ops for rooms with nothing left to fetch.
     */
    loadMore: () => Promise<void>;
}

export function useBackfillSocialRooms(rooms: Room[], client: MatrixClient, filter: SocialFeedFilter): BackfillState {
    const handled = useRef<Set<string>>(new Set());
    const pagesFetched = useRef<Map<string, number>>(new Map());
    const [generation, setGeneration] = useState(0);
    const [exhaustedRoomIds, setExhaustedRoomIds] = useState<ReadonlySet<string>>(new Set());

    const markExhausted = useCallback((roomId: string) => {
        setExhaustedRoomIds((prev) => (prev.has(roomId) ? prev : new Set(prev).add(roomId)));
    }, []);

    useEffect(() => {
        for (const room of rooms) {
            if (room.getMyMembership() !== KnownMembership.Join) continue;
            if (!roomCountsForFeed(room, filter)) continue;
            if (handled.current.has(room.roomId)) continue;
            handled.current.add(room.roomId);

            void Promise.all([
                backfillPages(client, room, INITIAL_PAGES_PER_ROOM, pagesFetched, markExhausted),
                loadMembersWithRetry(room),
            ]).then(() => {
                setGeneration((n) => n + 1);
            });
        }
    }, [rooms, client, filter, markExhausted]);

    const loadMore = useCallback(async (): Promise<void> => {
        const targets = rooms.filter(
            (room) =>
                room.getMyMembership() === KnownMembership.Join &&
                roomCountsForFeed(room, filter) &&
                !exhaustedRoomIds.has(room.roomId),
        );
        if (targets.length === 0) return;
        await Promise.all(targets.map((room) => backfillPages(client, room, 1, pagesFetched, markExhausted)));
        setGeneration((n) => n + 1);
    }, [rooms, client, filter, exhaustedRoomIds, markExhausted]);

    const hasMore = useMemo(
        () =>
            rooms.some(
                (room) =>
                    room.getMyMembership() === KnownMembership.Join &&
                    roomCountsForFeed(room, filter) &&
                    !exhaustedRoomIds.has(room.roomId),
            ),
        [rooms, filter, exhaustedRoomIds],
    );

    return { generation, hasMore, loadMore };
}

/**
 * Under Sliding Sync, a room's own concurrent state updates can race with (and clobber) the
 * out-of-band member data loadMembersIfNeeded() just fetched, so a single call doesn't reliably
 * stick the way it does under classic sync — confirmed by manually re-running loadMembersIfNeeded()
 * later fixing a post's sender avatar/name that the automatic call had already "handled" but failed
 * to actually resolve. Retry a few times with a short delay rather than accepting the first attempt
 * unconditionally.
 */
async function loadMembersWithRetry(room: Room): Promise<void> {
    for (let attempt = 0; attempt < MEMBER_LOAD_ATTEMPTS; attempt++) {
        try {
            await room.loadMembersIfNeeded();
        } catch {
            // fall through to retry below
        }
        if (room.membersLoaded()) return;
        if (attempt < MEMBER_LOAD_ATTEMPTS - 1) {
            await new Promise((resolve) => setTimeout(resolve, MEMBER_LOAD_RETRY_DELAY_MS));
        }
    }
}

async function backfillPages(
    client: MatrixClient,
    room: Room,
    pageCount: number,
    pagesFetched: RefObject<Map<string, number>>,
    markExhausted: (roomId: string) => void,
): Promise<void> {
    const already = pagesFetched.current.get(room.roomId) ?? 0;
    const remaining = Math.min(pageCount, MAX_PAGES_PER_ROOM - already);
    if (remaining <= 0) {
        markExhausted(room.roomId);
        return;
    }

    let fetched = already;
    for (let i = 0; i < remaining; i++) {
        const timeline = room.getLiveTimeline();
        try {
            const more = await client.paginateEventTimeline(timeline, {
                backwards: true,
                limit: PAGE_SIZE,
            });
            fetched++;
            if (!more) {
                markExhausted(room.roomId);
                break;
            }
        } catch {
            markExhausted(room.roomId);
            break;
        }
    }
    pagesFetched.current.set(room.roomId, fetched);
}

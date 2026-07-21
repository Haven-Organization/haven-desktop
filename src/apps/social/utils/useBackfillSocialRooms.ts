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
// How many rooms' initial backfill/member-load run concurrently - found 2026-07-20 firing this for
// every Feed-countable room at once (previously unbounded) floods the browser with a request per
// room simultaneously (72 simultaneous /messages requests on a 70-room account in one real repro),
// pegging the main thread badly enough that unrelated work elsewhere (e.g. the Social profile-open
// flow's own network calls, or even page.screenshot() in a Playwright session) couldn't get a timely
// turn either - this isn't just wasteful, it makes the whole app briefly unresponsive. Batching
// caps how many rooms are ever in flight at once without changing the eventual outcome (every
// eligible room still gets backfilled, just a handful at a time). Lowered from 6 to 3 (still
// 2026-07-20) after live testing showed 6 no longer freezes the app outright but still made
// whatever the user actually navigated to (e.g. a specific profile) feel sluggish while the other
// ~70 rooms' backfill competed for the same connections/CPU in the background - this hook's own
// work is a "nice to have" (extra Feed scroll-back buffer), so it should stay out of the way of
// whatever's actually on screen, not race it for resources.
const BACKFILL_CONCURRENCY = 3;
// Gives whatever the user just navigated to (a freshly opened profile/room) a clear run at its own
// initial network requests and render before this hook's own bulk backfill starts competing for the
// same connection pool and main-thread time - the eager Feed pre-warm this hook does has no urgency
// (nothing is blocked on it), so there's no cost to a short delay, only benefit to perceived
// responsiveness of whatever's actually on screen.
const BACKFILL_START_DELAY_MS = 500;

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
    // Mount-relative, not a per-effect-run cancelable timer - see the dispatch effect below for why.
    const mountTime = useRef(Date.now());

    const markExhausted = useCallback((roomId: string) => {
        setExhaustedRoomIds((prev) => (prev.has(roomId) ? prev : new Set(prev).add(roomId)));
    }, []);

    // Coalesces a burst of per-room completions into one state update - same reasoning and pattern
    // as SocialHomeView's own setRooms() debounce on Room.timeline (see its comment): with dozens of
    // rooms finishing their backfill in quick succession, bumping `generation` (and so re-rendering
    // every tile keyed on it) once per room rather than once per burst was itself a real source of
    // main-thread churn on top of the network-concurrency issue BACKFILL_CONCURRENCY fixes - found
    // 2026-07-20 in the same investigation, the UI was still unresponsive for 30-60s+ after capping
    // concurrency alone, on an account with 70+ social rooms.
    const generationBumpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const bumpGeneration = useCallback(() => {
        if (generationBumpTimer.current !== null) return;
        generationBumpTimer.current = setTimeout(() => {
            generationBumpTimer.current = null;
            setGeneration((n) => n + 1);
        }, 150);
    }, []);
    useEffect(
        () => () => {
            if (generationBumpTimer.current !== null) clearTimeout(generationBumpTimer.current);
        },
        [],
    );

    useEffect(() => {
        const toHandle = rooms.filter(
            (room) =>
                room.getMyMembership() === KnownMembership.Join &&
                roomCountsForFeed(room, filter) &&
                !handled.current.has(room.roomId),
        );
        if (toHandle.length === 0) return;
        // Claimed synchronously, before the delay below - once a room is in `toHandle` it WILL be
        // backfilled, no matter what happens to this effect afterwards.
        for (const room of toHandle) handled.current.add(room.roomId);

        const dispatch = (): void => {
            void runInBatches(toHandle, BACKFILL_CONCURRENCY, async (room) => {
                await Promise.all([
                    backfillPages(client, room, INITIAL_PAGES_PER_ROOM, pagesFetched, markExhausted),
                    loadMembersWithRetry(room),
                ]);
                bumpGeneration();
            });
        };

        // Delay is relative to when this hook first mounted, not to this specific effect run - if it
        // were a plain per-run setTimeout cancelled on cleanup (via `rooms` itself changing, which
        // happens often - see SocialHomeView's own debounced room-list refresh), a re-run before the
        // delay elapsed would cancel the pending dispatch for rooms already irreversibly marked
        // `handled` above, silently dropping them from ever being backfilled at all. Only the very
        // first burst of work after mount needs to wait for BACKFILL_START_DELAY_MS (giving whatever
        // the user just navigated to a clear run first); anything discovered later (rooms.filter
        // above found something new, e.g. a room finishing its own initial sync) has already missed
        // that window and can dispatch immediately.
        const remainingDelay = BACKFILL_START_DELAY_MS - (Date.now() - mountTime.current);
        if (remainingDelay <= 0) {
            dispatch();
        } else {
            setTimeout(dispatch, remainingDelay);
        }
    }, [rooms, client, filter, markExhausted, bumpGeneration]);

    const loadMore = useCallback(async (): Promise<void> => {
        const targets = rooms.filter(
            (room) =>
                room.getMyMembership() === KnownMembership.Join &&
                roomCountsForFeed(room, filter) &&
                !exhaustedRoomIds.has(room.roomId),
        );
        if (targets.length === 0) return;
        await runInBatches(targets, BACKFILL_CONCURRENCY, (room) =>
            backfillPages(client, room, 1, pagesFetched, markExhausted),
        );
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

/** Runs `worker` over `items`, at most `concurrency` in flight at once - unlike a plain
 *  `Promise.all(items.map(worker))`, this never starts more than `concurrency` workers
 *  simultaneously, starting each next one as soon as any slot frees up rather than in fixed
 *  batches (so one slow room can't stall the rest waiting for a whole batch to finish together). */
async function runInBatches<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
    let nextIndex = 0;
    async function runOne(): Promise<void> {
        while (nextIndex < items.length) {
            const item = items[nextIndex++];
            await worker(item);
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runOne));
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

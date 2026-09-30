/*
 * Social Overlay - useBackfillSocialRooms remount regression tests
 *
 * The Social app's whole view tree unmounts and remounts on a round trip through a different
 * top-level page (e.g. "All Chats" and back) - see app.ts. This hook's own already-handled
 * tracking has to survive that, or every return trip redoes a full backfill+member-load sweep for
 * every room, each completion remounting every visible post's body div (SocialEventTile keys it
 * on `pillsGeneration`) - the real cause of a live "feed keeps scrolling back up" report traced to
 * this file on 2026-09-28.
 */

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "test-utils-rtl";
import { mkStubRoom, createTestClient } from "test-utils";
import { KnownMembership, type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

import { useBackfillSocialRooms } from "./useBackfillSocialRooms";
import { EMPTY_SOCIAL_FEED_FILTER, type SocialFeedFilter } from "./socialFeedFilter";

function makeRoom(roomId: string, client: MatrixClient): Room {
    const room = mkStubRoom(roomId, roomId, client);
    room.getMyMembership = vi.fn().mockReturnValue(KnownMembership.Join);
    room.loadMembersIfNeeded = vi.fn().mockResolvedValue(undefined);
    room.membersLoaded = vi.fn().mockReturnValue(true);
    return room;
}

describe("useBackfillSocialRooms", () => {
    let client: MatrixClient;
    let filter: SocialFeedFilter;

    beforeEach(() => {
        client = createTestClient();
        client.paginateEventTimeline = vi.fn().mockResolvedValue(false); // one page, then exhausted
    });

    it("does not re-run member loading for a room it already handled in a previous mount", async () => {
        const room = makeRoom("!already-handled:example.org", client);
        filter = { ...EMPTY_SOCIAL_FEED_FILTER, includedRoomIds: [room.roomId] };

        const first = renderHook(() => useBackfillSocialRooms([room], client, filter));
        await waitFor(() => expect(room.loadMembersIfNeeded).toHaveBeenCalledTimes(1));
        first.unmount();

        // A second hook instance for the same room, as a remount would produce - a fresh room
        // object too, matching how a fresh SocialHomeView mount gets its room list from the client
        // rather than reusing the previous mount's own references.
        const secondRoom = makeRoom(room.roomId, client);
        renderHook(() => useBackfillSocialRooms([secondRoom], client, filter));

        // Give any (wrongly) re-triggered work a real chance to run before asserting it didn't.
        await new Promise((resolve) => setTimeout(resolve, 600));
        expect(secondRoom.loadMembersIfNeeded).not.toHaveBeenCalled();
    });

    it("still handles a genuinely new room on a second mount", async () => {
        const roomA = makeRoom("!room-a:example.org", client);
        const roomB = makeRoom("!room-b:example.org", client);
        filter = { ...EMPTY_SOCIAL_FEED_FILTER, includedRoomIds: [roomA.roomId, roomB.roomId] };

        const first = renderHook(() => useBackfillSocialRooms([roomA], client, filter));
        await waitFor(() => expect(roomA.loadMembersIfNeeded).toHaveBeenCalledTimes(1));
        first.unmount();

        const roomA2 = makeRoom(roomA.roomId, client);
        renderHook(() => useBackfillSocialRooms([roomA2, roomB], client, filter));

        await waitFor(() => expect(roomB.loadMembersIfNeeded).toHaveBeenCalledTimes(1));
        expect(roomA2.loadMembersIfNeeded).not.toHaveBeenCalled();
    });

    // Regression coverage for the debounce fix in this file - see bumpGeneration's own comment.
    // `generation` gates `pillsGeneration`, which remounts every visible post's message body
    // everywhere it's rendered (Feed, a profile, a group) - each extra bump is a real, felt UI
    // event, not just wasted work. A real backfill campaign completes rooms in a staggered
    // trickle (BACKFILL_CONCURRENCY caps how many run at once), not all at once, so the debounce
    // has to coalesce completions spread out over real time, not just ones landing in the same tick.
    it("coalesces a staggered trickle of room completions into a single generation bump", async () => {
        const ROOM_COUNT = 6;
        const rooms = Array.from({ length: ROOM_COUNT }, (_, i) => makeRoom(`!room-${i}:example.org`, client));
        const resolvers: Array<() => void> = [];
        rooms.forEach((room, i) => {
            room.loadMembersIfNeeded = vi.fn(
                () =>
                    new Promise<boolean>((resolve) => {
                        resolvers[i] = () => resolve(true);
                    }),
            );
        });
        filter = { ...EMPTY_SOCIAL_FEED_FILTER, includedRoomIds: rooms.map((r) => r.roomId) };

        const { result } = renderHook(() => useBackfillSocialRooms(rooms, client, filter));

        // Resolve every room's member load 300ms apart - wider than the old 150ms leading-edge
        // debounce's own window, so this reproduces the exact shape that used to defeat it, while
        // the whole spread (up to ~1.8s across 6 rooms) stays well under GENERATION_BUMP_MAX_WAIT_MS.
        // BACKFILL_CONCURRENCY caps how many rooms are in flight at once (3), so a later room's own
        // `loadMembersIfNeeded` call - and so its resolver here - only exists once an earlier one
        // resolves and frees a slot; waiting for each resolver in turn respects that staggering
        // instead of assuming all six start at once.
        for (let i = 0; i < ROOM_COUNT; i++) {
            await waitFor(() => expect(resolvers[i]).toBeDefined());
            resolvers[i]();
            await new Promise((resolve) => setTimeout(resolve, 300));
        }

        // The trailing debounce should still be waiting out its quiet window right after the last
        // completion - nothing should have committed yet.
        expect(result.current.generation).toBe(0);

        // Let the debounce's own quiet window elapse (GENERATION_BUMP_DEBOUNCE_MS, 1000ms) with no
        // further completions.
        await waitFor(() => expect(result.current.generation).toBe(1), { timeout: 2000 });

        // Give it a further beat to confirm it really settled at exactly one bump, not one per room.
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(result.current.generation).toBe(1);
    });
});

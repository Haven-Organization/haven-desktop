/*
 * Social Overlay — pendingFocusEvent
 *
 * Same bridge pattern as pendingViewUser.ts/pendingViewPost.ts (see those for why a plain module
 * value is needed at all) - carries "once you're mounted for this room, open a thread focused on
 * this specific event" from SocialHomeView's own pendingViewPost consumption (see
 * permalinkRouting.ts) into SocialRoomView, which owns the room-level threadEvent state itself.
 * SocialHomeView navigates to the room via its own nav.roomId (which SocialRoomView doesn't exist
 * in the DOM yet at the moment that decision is made); this is what survives the trip.
 *
 * Carries the real, already-resolved MatrixEvent - not just its id - deliberately. This used to be
 * just an id, with SocialRoomView re-resolving it itself via room.findEventById (falling back to
 * its own fetchRoomEvent call if that failed). That redundant second resolution attempt is exactly
 * what caused "auto-accepted the follow request, but never opened the post": resolveAndOpenPost
 * (in SocialEventTile.tsx) already does real work to resolve this event - including its own
 * fetchRoomEvent fallback for a room whose just-joined initial sync doesn't reach back far enough -
 * only to have that resolved event thrown away and re-derived from scratch here, hitting the exact
 * same "not in the synced timeline yet" wall a second time. Carrying the already-resolved event
 * through directly removes the redundant, independently-fallible second attempt entirely.
 *
 * Deliberately a non-destructive peek, not a "consume once" read (fixed - this used to clear
 * itself on read, and that broke under React StrictMode's development-only double-invoke of
 * effects: StrictMode mounts a component, immediately discards it (running cleanup), then mounts
 * a fresh instance - specifically to catch missing-cleanup bugs. The *first*, throwaway mount's
 * effect read (and cleared) this value and correctly set its own threadEvent state, but that
 * entire mount - state included - gets thrown away; the second, real, persisted mount's identical
 * effect then found nothing left to read, since the first mount had already consumed it. A
 * destructive "read it exactly once, from anywhere" global is fundamentally incompatible with
 * anything that might read it twice as part of one logical mount - peeking instead means both the
 * throwaway and the real mount see the same value and reach the same (correct) result. The
 * tradeoff: this can very rarely re-focus an old post if you later revisit the exact same room
 * without clicking a new link - far less disruptive than never opening the post at all, which is
 * what this replaces. */

import { type MatrixEvent } from "matrix-js-sdk/src/matrix";

let pendingFocusEvent: MatrixEvent | null = null;

export function setPendingFocusEvent(event: MatrixEvent): void {
    pendingFocusEvent = event;
}

export function peekPendingFocusEvent(): MatrixEvent | null {
    return pendingFocusEvent;
}

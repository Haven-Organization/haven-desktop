import { type Membership, KnownMembership } from "matrix-js-sdk/src/matrix";

/**
 * Guards against a well-known Matrix sync race: client.leave() (and the same-shaped optimistic
 * local echo Haven applies right after - see unfollowRoom/leaveRoomBehaviour) resolves as soon as
 * the server responds, but the client's own /sync loop may already have a *different* long-poll
 * request in flight - one that was sent before the leave, so it still reports the pre-leave
 * membership. That stale response lands moments later and matrix-js-sdk applies it exactly like any
 * other sync update, silently reverting the just-applied "leave" back to "join" - this is what
 * showed up as "briefly flickers to Private, then flips right back to Leave."
 *
 * Marked right after the optimistic update; useRoomMembership's own listener checks this before
 * trusting a membership update, and ignores a *contradicting* (non-leave) one for a room the guard
 * is active for. A genuine "leave" update, whenever it eventually arrives, both satisfies and clears
 * the guard - nothing left to protect against once the real confirmation shows up. Auto-expires
 * after a generous timeout regardless, as a safety net against a permanently stuck guard if that
 * confirmation somehow never arrives.
 */
const pendingLeaveRoomIds = new Set<string>();
const GUARD_TIMEOUT_MS = 30_000;

export function markPendingLeave(roomId: string): void {
    pendingLeaveRoomIds.add(roomId);
    setTimeout(() => pendingLeaveRoomIds.delete(roomId), GUARD_TIMEOUT_MS);
}

export function shouldIgnoreStaleMembership(roomId: string, newMembership: Membership): boolean {
    if (!pendingLeaveRoomIds.has(roomId)) return false;
    if (newMembership === KnownMembership.Leave) {
        pendingLeaveRoomIds.delete(roomId);
        return false;
    }
    return true;
}

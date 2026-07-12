/*
 * Social Overlay — pendingRoomPick
 *
 * Bridges a room picked in RoomPickerModal back to PostComposerDialog's own explicitRoomId state,
 * surviving a render-level "remount" that Modal.tsx's single-root modal stack causes whenever a
 * second modal (RoomPickerModal) is opened on top of an already-open one (PostComposerDialog, via
 * RepostDialog's quote post or PostDialog's plain post) - a plain onChange prop doesn't survive
 * this, unlike RoomPickerButton's other caller (SocialHomeView's FeedPane composer), which renders
 * inline in the page rather than inside a Modal.createDialog, so it never hits this at all.
 *
 * Modal.tsx's reRender() renders only the current top-of-stack modal's `elem` into one shared React
 * root. Opening RoomPickerModal on top of PostComposerDialog swaps the root's rendered element from
 * PostComposerDialog's tree to RoomPickerModal's tree - a different component type at that position,
 * so React unmounts PostComposerDialog's live instance outright, not merely hides it. When
 * RoomPickerModal later closes, the root swaps back to PostComposerDialog's original `elem` (the same
 * object reference, captured once at open time) - but since a different type occupied that slot in
 * between, React mounts a brand-new instance with fresh state, not the discarded one.
 * RoomPickerButton's onChange callback (closed over the dead instance's setExplicitRoomId) still
 * fires moments later via the `finished` promise, but calling a state setter from an unmounted
 * component instance is a no-op - the freshly-mounted instance never receives it, and silently keeps
 * showing its default ("Your Profile", or whichever room happened to be first) no matter which room
 * was actually picked.
 *
 * Fix: RoomPickerModal writes the picked room id here synchronously, in the same tick as calling its
 * own onFinished - strictly before Modal's reRender/remount runs - so by the time
 * PostComposerDialog's fresh instance mounts, the value is already there for its own explicitRoomId
 * state to pick up via a lazy initializer. Non-destructive peek (not consume-once), for the same
 * StrictMode reason as pendingFocusEvent.ts: React 18 StrictMode double-invokes a useState lazy
 * initializer to check purity, and a destructive read would make one of those two invocations find
 * nothing.
 *
 * Cleared on PostComposerDialog's own real unmount (the dialog actually closing - submitted or
 * cancelled, not the picker-induced fake unmount above), so a later, unrelated fresh Post/Quote-post
 * open doesn't inherit a stale pick left over from a previous session.
 */

let pendingRoomPick: string | null = null;

export function setPendingRoomPick(roomId: string): void {
    pendingRoomPick = roomId;
}

export function peekPendingRoomPick(): string | null {
    return pendingRoomPick;
}

export function clearPendingRoomPick(): void {
    pendingRoomPick = null;
}

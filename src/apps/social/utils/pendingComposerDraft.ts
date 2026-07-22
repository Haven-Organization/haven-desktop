/*
 * Social Overlay — pendingComposerDraft
 *
 * Bridges an in-progress caption and staged attachment across the same PostComposerDialog "fake
 * remount" pendingRoomPick.ts already documents in full (opening RoomPickerModal on top of an
 * already-open Post/Quote dialog swaps Modal's single shared root to a different component,
 * unmounting the live dialog instance outright rather than merely hiding it). explicitRoomId
 * already survives that remount via pendingRoomPick's bridge; body and the pasted/picked
 * attachment did not - opening the room picker mid-compose silently discarded whatever caption was
 * typed and whatever file was staged in the shelf, with no visible error, so a user who then
 * retyped their caption (not noticing the shelf had gone empty) ended up sending a text-only post
 * that looked, from their perspective, like the staged image had simply been dropped on send -
 * confirmed live 2026-07-22 (paste image, type caption, open the room picker, pick a room: both
 * the caption and the shelf came back empty on the dialog's fresh instance).
 *
 * Unlike pendingRoomPick, this bridge is written by PostComposerDialog itself (via its own unmount
 * cleanup - see isClosingRef there), not by whatever opened on top of it, so it can't rely on
 * "unconditionally clear on every unmount" the way pendingRoomPick does - that would clear this
 * bridge on the very fake-unmount it's meant to survive. PostComposerDialog explicitly clears it
 * on a real close (submitted or cancelled) instead, so a later, unrelated Post/Quote-post open
 * doesn't inherit a stale draft.
 *
 * Same non-destructive peek (not consume-once) as pendingRoomPick, and the same reason: React 18
 * StrictMode double-invokes a useState lazy initializer to check purity, and a destructive read
 * would make one of those two invocations find nothing.
 */

export interface PendingComposerDraft {
    body: string;
    file: File | null;
}

let pendingDraft: PendingComposerDraft | null = null;

export function setPendingComposerDraft(draft: PendingComposerDraft): void {
    pendingDraft = draft;
}

export function peekPendingComposerDraft(): PendingComposerDraft | null {
    return pendingDraft;
}

export function clearPendingComposerDraft(): void {
    pendingDraft = null;
}

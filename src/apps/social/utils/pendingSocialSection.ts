/*
 * Social Overlay — pendingSocialSection
 *
 * Bridges a deep-linked Social tab ("social/groups" or "social/profile" - see permalinkRouting.ts's
 * tryRouteSocialHashScreen) into SocialHomeView's own initial nav state - the same "click/navigation
 * happened before the component existed to hear about it" problem pendingViewUser.ts solves for
 * other Social entry points: SOCIAL_HOME_ACTION is dispatched to mount SocialHomeView in the first
 * place, so there's no live dispatch left for it to listen for by the time it exists.
 *
 * Read via a lazy useState initializer in SocialHomeView (not a mount effect) - a lazy initializer
 * runs during render itself, so its result is already safely captured into React state before any
 * of StrictMode's development-only effect double-invoking (mount -> discard/cleanup -> remount) can
 * happen. A plain non-destructive peek here is what makes that safe even though StrictMode also
 * double-invokes the initializer itself (to check purity) - peeking twice returns the same value
 * both times, unlike a destructive consume, which would leave the second call with nothing. Same
 * reasoning as peekPendingViewUserId.
 *
 * Cleared separately, via a genuine mount effect (not the initializer) - safe to do from an effect
 * specifically because by the time any effect runs, the initializer has already captured the
 * correct value into nav state; clearing the bridge afterward doesn't unwind that. Without this,
 * closing Social and reopening it later with no new deep link would incorrectly reapply a stale
 * section from a much earlier link click.
 */
export type PendingSocialSection = "groups" | "profile";

let pendingSection: PendingSocialSection | null = null;

export function setPendingSocialSection(section: PendingSocialSection): void {
    pendingSection = section;
}

export function peekPendingSocialSection(): PendingSocialSection | null {
    return pendingSection;
}

export function clearPendingSocialSection(): void {
    pendingSection = null;
}

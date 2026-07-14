/*
 * Haven framework — pendingActiveApp
 *
 * Same "dispatch happened before the listener existed to hear it" problem Social's own
 * pendingSocialSection.ts solves (see its own comment for the full explanation) - a Haven app's
 * home action can be dispatched synchronously during cold-start routing (a deep link straight into
 * an app, e.g. #/social), before SpacePanel ever mounts to register useActiveAppId's dispatcher
 * listener for it. Without this bridge, that first dispatch is missed entirely: activeAppId stays
 * null, isAppMode stays false, and SpacePanel's own "deselect Home while an app is open" logic never
 * fires - so Home renders selected even though the app is genuinely open.
 *
 * Read via a lazy useState initializer in useActiveAppId (not a mount effect) - a lazy initializer
 * runs during render itself, so it's already safely captured into React state before any of
 * StrictMode's development-only effect double-invoking (mount -> discard/cleanup -> remount) can
 * happen. A plain non-destructive peek here is what makes that safe even though StrictMode also
 * double-invokes the initializer itself (to check purity) - peeking twice returns the same value
 * both times, unlike a destructive consume, which would leave the second call with nothing.
 *
 * Cleared separately, via a genuine mount effect (not the initializer) - safe to do from an effect
 * specifically because by the time any effect runs, the initializer has already captured the
 * correct value into state; clearing the bridge afterward doesn't unwind that. Without this, closing
 * an app and SpacePanel later remounting with no new deep link would incorrectly reapply a stale
 * app id from a much earlier cold start.
 */
let pendingActiveAppId: string | null = null;

export function setPendingActiveAppId(appId: string): void {
    pendingActiveAppId = appId;
}

export function peekPendingActiveAppId(): string | null {
    return pendingActiveAppId;
}

export function clearPendingActiveAppId(): void {
    pendingActiveAppId = null;
}

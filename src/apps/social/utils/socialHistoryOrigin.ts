/*
 * Social Overlay — socialHistoryOrigin
 *
 * Social's own "social/room/!id/$eventId" hash (see permalinkRouting.ts's tryRouteSocialHashScreen)
 * is identical whether a post was reached from the aggregated Feed's own thread panel or from that
 * room's dedicated Social page - the confirmed two-shape URL scheme has no room left in the hash
 * itself to distinguish them, and adding a third shape/query param for this would break that
 * scheme's own simplicity for what's otherwise a purely internal "which surrounding view were you
 * in" detail with no bearing on what a shared link should do.
 *
 * history.state carries exactly this kind of per-entry metadata that doesn't belong in the URL:
 * stampSocialOrigin() is called right after each hash write Social itself makes (FeedPane's and
 * SocialRoomView's own onNewScreen-calling effects), annotating the entry onNewScreen just created
 * without altering how it was created (no change to routing.ts's own assign/replace-based
 * onNewScreen, so stock Element's hashchange-driven routing is untouched). getLastPopStateOrigin()
 * is read back out by tryRouteSocialHashScreen on the next hashchange to decide which of the two
 * views a "social/room/!id/$eventId" hash should actually restore.
 *
 * Ordering this relies on: per spec, popstate always fires before hashchange for the same
 * back/forward/go navigation (browsers dispatch them synchronously, popstate first) - so by the
 * time hashchange's own listener (routing.ts's onHashChange) runs routeUrl ->
 * tryRouteSocialHashScreen, this module's popstate listener has already updated lastPopStateOrigin
 * for tryRouteSocialHashScreen to read. This listener is registered eagerly at module load (this
 * file is imported, transitively, from routing.ts's own bootstrap-time import chain), well before
 * any user interaction could fire a popstate.
 */

export type SocialOrigin = "feed" | "room";

interface SocialHistoryState {
    socialOrigin?: SocialOrigin;
}

let lastPopStateOrigin: SocialOrigin | undefined;

window.addEventListener("popstate", (event: PopStateEvent) => {
    lastPopStateOrigin = (event.state as SocialHistoryState | null)?.socialOrigin;
});

export function stampSocialOrigin(origin: SocialOrigin): void {
    const current = (history.state as SocialHistoryState | null) ?? {};
    history.replaceState({ ...current, socialOrigin: origin }, "", window.location.href);
}

export function getLastPopStateOrigin(): SocialOrigin | undefined {
    return lastPopStateOrigin;
}

/*
 * Social Overlay — lastSocialViewState
 *
 * Remembers which Social page (Feed/Profile/Group room, or the Groups list) and scroll offset the
 * user was last on, so that navigating away from Social entirely (e.g. clicking Home or a Space in
 * the left nav) and then back into Social restores both, rather than always landing back on Feed at
 * the top. Needed because SocialHomeView - and everything under it, including its own `nav` state -
 * is fully unmounted the moment `page_type` switches away from Social (see LoggedInView.tsx's
 * `pageElement` switch); nothing keeps it alive in the background the way `.social_Content` persists
 * across a Feed <-> thread-view transition within a single mount (see FeedPane's own scroll-save/
 * restore for that separate, in-mount case).
 *
 * Unlike pendingSocialSection.ts/pendingViewUser.ts (one-shot "a click just outside Social wants
 * this specific thing to happen next"), this is a continuously-updated cache, not a consume-once
 * bridge - every mount that finds it unset (never been in Social this session) still falls back to
 * the plain Feed default, and every subsequent departure overwrites it with wherever the user ended
 * up, so returning to Social always reflects the most recent visit, however many round trips happen
 * in a session. Read via a lazy useState initializer in SocialHomeView (same reasoning as
 * pendingSocialSection.ts: safe under StrictMode's double-invoked initializers, unlike a destructive
 * consume would be), written from a genuine unmount-only effect cleanup instead.
 */
import { type SocialNav } from "../views/SocialHomeView";

let lastState: { nav: SocialNav; scrollTop: number } | null = null;

export function saveLastSocialViewState(nav: SocialNav, scrollTop: number): void {
    lastState = { nav, scrollTop };
}

export function peekLastSocialViewState(): { nav: SocialNav; scrollTop: number } | null {
    return lastState;
}

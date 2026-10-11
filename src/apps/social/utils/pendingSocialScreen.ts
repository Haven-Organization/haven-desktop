/*
 * Social Overlay - pendingSocialScreen
 *
 * The URL ("screen") Social has been asked to end up on, from the moment an explicit destination
 * is handed to it (permalinkRouting.ts's routeToSocial: a matrix.to link, Spotlight, Shift+Click
 * on a timestamp, or a "social/room/..." hash) until that destination's own page writes it.
 *
 * Getting there takes a few renders: Social mounts on whatever page it was last on, switches to
 * the destination room's page, and only then opens the post. Each of those pages keeps the URL bar
 * in sync with itself, and every write pushes a browser history entry - so a post opened from the
 * stock room view left "room view, Social profile page, post" in history, and Back from the post
 * landed on a Social profile page the user had never looked at instead of the room view they came
 * from. While a destination is pending, writeSocialScreen (socialScreen.ts) skips every URL that
 * isn't it, so history goes straight from where the user was to where they asked to go.
 *
 * Kept free of imports on purpose - permalinkRouting.ts sets this, and vector/routing.ts (which
 * socialScreen.ts needs for onNewScreen) imports permalinkRouting.ts.
 */

/** A destination that never gets written (resolution failed in a way that wasn't cleared, or the
 *  user navigated elsewhere first) stops suppressing URL updates after this long. */
const PENDING_SCREEN_TTL_MS = 10_000;

let pending: { screen: string; setAt: number } | null = null;

export function socialRoomScreen(roomId: string, eventId?: string | null): string {
    return `social/room/${roomId}${eventId ? `/${eventId}` : ""}`;
}

export function setPendingSocialScreen(roomId: string, eventId?: string | null): void {
    pending = { screen: socialRoomScreen(roomId, eventId), setAt: Date.now() };
}

export function clearPendingSocialScreen(): void {
    pending = null;
}

/** The screen Social is still on its way to, or null if there isn't one (or it expired). */
export function peekPendingSocialScreen(): string | null {
    if (pending && Date.now() - pending.setAt > PENDING_SCREEN_TTL_MS) pending = null;
    return pending?.screen ?? null;
}

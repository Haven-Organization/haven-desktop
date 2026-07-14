/*
 * Social Overlay — permalinkRouting
 *
 * Makes matrix.to/matrix: links to a Social profile/group room open in Social (at that post, if the
 * link carries an event ID) instead of the regular Element room view, everywhere such a link can be
 * clicked - message bodies, linkified plain-text mentions, room topics. Holding Shift while clicking
 * always forces normal Element-mode navigation, bypassing this entirely.
 *
 * Two entry points, both used from a permalink click handler *before* it does its own normal
 * navigation for the link:
 *   - tryRouteSocialPermalink(event, href) - the common case, when all the caller has is a raw
 *     href to parse (message bodies, room topics).
 *   - tryRouteSocialRoom(event, roomIdOrAlias, eventId, onNotSocial) - for callers that already
 *     have the room ID/alias in hand (Linkify's onAliasClick), passing their own "not social, do
 *     your normal thing" fallback explicitly rather than a href to fall back to.
 *
 * Both return true and take over navigation themselves (into Social) when the target is already
 * known locally to be a Social room, or once an async room-type check later confirms it is - the
 * caller should preventDefault() and do nothing else. They return false when Shift was held, the
 * link isn't a permalink at all, or the room is already known locally and is *not* social - the
 * caller should proceed exactly as if this was never called. For a target room that isn't known
 * locally at all (can't be classified synchronously), they still return true, and the room-type
 * check happens asynchronously afterwards - if it turns out not to be social, the caller's own
 * fallback (onNotSocial, or the href-based one tryRouteSocialPermalink builds internally) runs
 * instead, since by then the caller has already preventDefault-ed and returned.
 */

import { MatrixClientPeg } from "../../../../element-web/apps/web/src/MatrixClientPeg";
import defaultDispatcher from "../../../../element-web/apps/web/src/dispatcher/dispatcher";
import {
    parsePermalink,
    tryTransformPermalinkToLocalHref,
} from "../../../../element-web/apps/web/src/utils/permalinks/Permalinks";
import { SOCIAL_HOME_ACTION } from "../homeAction";
import { setPendingViewPost } from "./pendingViewPost";
import { setPendingFeedThread } from "./pendingFeedThread";
import { getLastPopStateOrigin } from "./socialHistoryOrigin";
import { isSocialRoom, MSC4501_ROOM_TYPE_PROFILE, MSC4501_ROOM_TYPE_GROUP } from "./room-classifier";
import { setPendingSocialSection } from "./pendingSocialSection";
import { setPendingPostModal } from "./pendingPostModal";
import { socialApp } from "../app";
import { setPendingActiveAppId } from "../../framework/pendingActiveApp";

// sync: matches SocialProfileButton's own dispatch - beats any other pending navigation dispatched
// around the same time (e.g. the caller's own event still bubbling). Also bridges into
// useActiveAppId's initial state (see pendingActiveApp.ts) - on a cold-start deep link this dispatch
// happens before SpacePanel ever mounts to hear it directly.
function dispatchSocialHomeAction(): void {
    setPendingActiveAppId(socialApp.id);
    defaultDispatcher.dispatch({ action: SOCIAL_HOME_ACTION }, true);
}

function routeToSocial(roomId: string, eventId: string | null): void {
    setPendingViewPost(roomId, eventId ?? undefined);
    dispatchSocialHomeAction();
}

/**
 * Core logic, for callers that already have a room ID/alias + optional event ID in hand (e.g.
 * Linkify's onAliasClick) rather than a raw href to parse. `onNotSocial` is called (synchronously
 * or later, once the async summary check resolves) when this turns out not to be a social room at
 * all - the caller's own normal navigation for that case, e.g. dispatching Action.ViewRoom or
 * falling back to a plain hash change.
 */
export function tryRouteSocialRoom(
    event: { shiftKey?: boolean },
    roomIdOrAlias: string,
    eventId: string | null,
    onNotSocial: () => void,
): boolean {
    if (event.shiftKey) return false;

    const client = MatrixClientPeg.get();
    if (!client) return false;

    // Fast path: already known locally (joined, peeked, or previously resolved) - a synchronous,
    // definite answer, so a non-social room here should just fall through to the caller's own
    // normal handling rather than claiming it and doing nothing.
    if (!roomIdOrAlias.startsWith("#")) {
        const knownRoom = client.getRoom(roomIdOrAlias);
        if (knownRoom) {
            if (!isSocialRoom(knownRoom)) return false;
            routeToSocial(knownRoom.roomId, eventId);
            return true;
        }
    }

    // Not known locally (or referenced by alias) - resolve via room summary (MSC3266, accepts
    // either a room ID or an alias) before deciding. The caller treats this as "handled" even
    // though the actual decision finishes asynchronously.
    void client.getRoomSummary(roomIdOrAlias).then(
        (summary) => {
            if (summary.room_type === MSC4501_ROOM_TYPE_PROFILE || summary.room_type === MSC4501_ROOM_TYPE_GROUP) {
                routeToSocial(summary.room_id, eventId);
            } else {
                onNotSocial();
            }
        },
        onNotSocial,
    );
    return true;
}

export function tryRouteSocialPermalink(event: { shiftKey?: boolean }, href: string): boolean {
    const parsed = parsePermalink(href);
    if (!parsed?.roomIdOrAlias) return false;

    const localHref = tryTransformPermalinkToLocalHref(href);
    return tryRouteSocialRoom(event, parsed.roomIdOrAlias, parsed.eventId, () => {
        if (localHref !== href) window.location.hash = localHref;
    });
}

/**
 * Entry point for routing.ts's own routeUrl() (and MatrixChat.showScreen()'s own cold-start call to
 * this same function - see its own comment) - handles a "social", "social/groups", "social/profile",
 * or "social/room/!id[/$eventId]" screen string (see getScreenFromLocation) the same way a matrix.to
 * link would, but synchronously and unconditionally, since a hash the browser is already navigating
 * to (typed directly, or via back/forward through history) isn't a click to second-guess with Shift
 * or a "not actually social" fallback - by construction, anything under the social/ prefix is always
 * meant for Social. Returns false for any other screen so the caller's own stock handling proceeds
 * unchanged.
 *
 * `params` (query params from the hash, e.g. "#/social?post=1&body=hi") only matters for the bare
 * "social" screen right now - see the post/body handling below.
 */
export function tryRouteSocialHashScreen(screen: string, params?: Record<string, unknown>): boolean {
    if (screen === "social") {
        // ?post=1[&body=...] opens the Post composer directly (optionally prefilled) once
        // SocialHomeView mounts - see pendingPostModal.ts for why this can't just be a prop/dispatch
        // payload.
        if (params?.post) {
            setPendingPostModal({ body: typeof params.body === "string" ? params.body : undefined });
        }
        dispatchSocialHomeAction();
        return true;
    }
    if (screen === "social/groups" || screen === "social/profile") {
        setPendingSocialSection(screen === "social/groups" ? "groups" : "profile");
        dispatchSocialHomeAction();
        return true;
    }
    if (!screen.startsWith("social/room/")) return false;

    const rest = screen.substring("social/room/".length);
    const slashDollar = rest.indexOf("/$");
    const roomId = slashDollar === -1 ? rest : rest.substring(0, slashDollar);
    const eventId = slashDollar === -1 ? null : rest.substring(slashDollar + 1);
    if (!roomId) return false;

    // Same hash, two possible prior views (see socialHistoryOrigin.ts's own doc) - only
    // distinguishable via the history entry's own stamped state, read here via
    // getLastPopStateOrigin() (populated by that module's popstate listener, which - per spec -
    // always fires before the hashchange that reaches this function). Anything other than an
    // explicit "feed" (typed/shared links land with no state at all, i.e. undefined) means the
    // dedicated room page, matching every prior behaviour this hash shape has ever had.
    if (eventId && getLastPopStateOrigin() === "feed") {
        setPendingFeedThread(roomId, eventId);
        dispatchSocialHomeAction();
        return true;
    }

    routeToSocial(roomId, eventId);
    return true;
}

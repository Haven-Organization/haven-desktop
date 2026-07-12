/*
 * Social Overlay — Room Classifier
 *
 * Uses MSC4501 unstable event-type prefixes throughout.
 * Do NOT replace with stable types — this MSC is not yet merged.
 */

import { type Room, EventType } from "matrix-js-sdk/src/matrix";

// ---------------------------------------------------------------------------
// MSC4501 unstable constants
// ---------------------------------------------------------------------------

export const MSC4501_ROOM_TYPE_PROFILE = "org.matrix.msc4501.social.profile";
export const MSC4501_ROOM_TYPE_GROUP = "org.matrix.msc4501.social.group";
export const MSC4501_EVENT_POST = "org.matrix.msc4501.social.post";

// Cross-room post references (reposts/boosts/quote-posts and cross-posted replies) — see the
// "Cross-room post references" section of MSC4501. Superseded the old flat
// org.matrix.msc4501.social.repost_of field with a nested block carrying its own rel_type, mirroring
// (but distinct from) real Matrix m.relates_to. A bridge (e.g. matrix-appservice-activitypub
// mirroring poa.st/Soapbox) already sends this shape — clients still checking the old flat field
// silently fail to recognize any of its reposts/boosts as such.
export const MSC4501_RELATES_TO_KEY = "org.matrix.msc4501.social.relates_to";
export const MSC4501_REL_TYPE_REPOST = "org.matrix.msc4501.social.repost";
export const MSC4501_REL_TYPE_REPLY = "org.matrix.msc4501.social.reply";

// MSC4501 — links a user's Matrix account to their profile room (depends on MSC4133 for the
// extensible profile-field mechanism itself)
export const MSC4501_PROFILE_ROOM_KEY = "org.matrix.msc4501.social.profile_room_id";

// MSC4501 — the inverse of MSC4501_PROFILE_ROOM_KEY: lives on a profile room's own state (state_key
// "") and points back at the user it's a profile of, so a room's true owner is knowable even when
// m.room.create's creator isn't them (e.g. a bridge/appservice creating the room on someone's
// behalf). Must be protected by a power_levels.events override at room-creation time — see
// createSocialRoom.ts — since it isn't one of the event types m.room.power_levels gives a default
// override for, and would otherwise fall back to state_default (typically Moderator, not Admin).
export const MSC4501_PROFILE_USER_ID_KEY = "org.matrix.msc4501.social.profile_user_id";

// Room banner state event, per MSC4221 (https://github.com/matrix-org/matrix-spec-proposals/pull/4221).
// Still unstable — the MSC's own "Unstable prefix" section says to use this instead of m.room.banner
// while unstable. Switch to the stable name only once MSC4221 is actually accepted into the spec.
export const ROOM_BANNER_EVENT_TYPE = "page.codeberg.everypizza.room.banner";

/** All room types considered "social" for feed purposes. */
export const SOCIAL_ROOM_TYPES = [MSC4501_ROOM_TYPE_PROFILE, MSC4501_ROOM_TYPE_GROUP] as const;
export type SocialRoomType = (typeof SOCIAL_ROOM_TYPES)[number];

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

function getRoomType(room: Room): string | undefined {
    const createEvent = room.currentState.getStateEvents(EventType.RoomCreate, "");
    if (!createEvent) return undefined;
    return (createEvent.getContent() as { type?: string }).type;
}

/** True when the room is a social Profile room (MSC4501). */
export function isProfileRoom(room: Room): boolean {
    return getRoomType(room) === MSC4501_ROOM_TYPE_PROFILE;
}

/** True when the room is a social Group room (MSC4501). */
export function isGroupRoom(room: Room): boolean {
    return getRoomType(room) === MSC4501_ROOM_TYPE_GROUP;
}

/** True when the room is either a Profile or Group (i.e. any social room). */
export function isSocialRoom(room: Room): boolean {
    const t = getRoomType(room);
    return t === MSC4501_ROOM_TYPE_PROFILE || t === MSC4501_ROOM_TYPE_GROUP;
}

export function getSocialRoomType(room: Room): SocialRoomType | undefined {
    const t = getRoomType(room);
    if (t === MSC4501_ROOM_TYPE_PROFILE || t === MSC4501_ROOM_TYPE_GROUP) {
        return t as SocialRoomType;
    }
    return undefined;
}

/** "profile"/"group" for a Social room, or null for a regular room - used by patched stock
 *  components (Room Settings and its tabs) to swap generic "room" wording for the more specific
 *  Social term when editing a Social room, without changing anything for a regular room. */
export function socialRoomKind(room: Room): "profile" | "group" | null {
    if (isProfileRoom(room)) return "profile";
    if (isGroupRoom(room)) return "group";
    return null;
}

/** Matches the same shape social-actions.ts's PROFILE_ROOM_ID_PATTERN uses for room IDs, just for a
 *  user ID instead: @localpart:domain, both parts non-empty and whitespace-free. Not full MSC-spec
 *  grammar validation, just a sanity check that this looks like a real MXID rather than garbage. */
const PROFILE_USER_ID_PATTERN = /^@[^\s:]+:[^\s]+$/;

/** Reads the MSC4501_PROFILE_USER_ID_KEY state event (state_key "") off a profile room and returns
 *  its user_id, but only when it's actually present and looks like a valid MXID - a malformed or
 *  missing value returns undefined rather than showing garbage under the profile name. */
export function getVerifiedProfileUserId(room: Room): string | undefined {
    const event = room.currentState.getStateEvents(MSC4501_PROFILE_USER_ID_KEY, "");
    const userId = (event?.getContent() as { user_id?: string } | undefined)?.user_id;
    return userId && PROFILE_USER_ID_PATTERN.test(userId) ? userId : undefined;
}

/** The profile room's true owner user id: the verified MSC4501_PROFILE_USER_ID_KEY owner if
 *  present, falling back to m.room.create's creator otherwise. Use this instead of the room
 *  creator alone anywhere "is this the profile owner" matters (Edit Profile visibility, hiding the
 *  redundant room-name badge on the owner's own posts, etc.) - a profile room provisioned by a
 *  bridge/appservice on the owner's behalf has a creator that isn't the actual owner (see
 *  getVerifiedProfileUserId's own doc above), and checking the creator alone silently
 *  mis-attributes ownership in that case. Returns undefined for a non-profile room. */
export function getProfileOwnerUserId(room: Room): string | undefined {
    if (!isProfileRoom(room)) return undefined;
    return getVerifiedProfileUserId(room) ?? room.currentState.getStateEvents(EventType.RoomCreate, "")?.getSender() ?? undefined;
}

// findMyProfileRoom (a local best-guess for "the user's profile room" while the real MSC4501
// profile_room_id link was still resolving) used to live here. Removed: a user can genuinely have
// more than one currently-joined room that locally looks like "theirs" (own creator, or verified
// via profile_user_id) with no reliable local signal to tell which one the real link will resolve
// to - guessing (by creation time or otherwise) was provably wrong at least once in production
// ("my old profile popped up for a couple seconds before my actual profile room appears", where
// the room that flashed was actually the *newer* of two by creation time). The profile room is
// always whatever org.matrix.msc4501.social.profile_room_id names on the user's own profile (see
// useProfileRoomLink) - callers now just show a loading state while that's still resolving,
// instead of a confident-but-possibly-wrong local guess.

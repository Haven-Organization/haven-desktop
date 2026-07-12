/*
 * Social Overlay — Feed filter
 *
 * A client-local preference (not part of MSC4501 itself — the MSC explicitly leaves "which rooms
 * feed into a feed" as a client-local preference, persisted however a client already syncs its own
 * settings; see MSC4501's Feeds section), stored in the user's own account data so it follows them
 * across sessions/devices.
 */

import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

import { MSC4501_ROOM_TYPE_PROFILE, MSC4501_ROOM_TYPE_GROUP } from "./room-classifier";

export const SOCIAL_FEED_FILTER_EVENT_TYPE = "software.haven.social.feed_filter";

export interface SocialFeedFilter {
    /** Extra room `type`s (beyond the built-in Social Rooms types) whose rooms' posts should be
     *  included in the feed. */
    extraRoomTypes: string[];
    /** Specific room ids/aliases to include in the feed regardless of the room's own `type` —
     *  distinct from extraRoomTypes, which matches by type rather than by specific room. */
    includedRoomIds: string[];
    /** Room ids/aliases whose posts should be excluded from the feed even though the room would
     *  otherwise qualify (via its type or via includedRoomIds). Exclusion always wins over
     *  inclusion — see roomCountsForFeed. */
    excludedRoomIds: string[];
    /** User ids whose posts should be excluded from the feed. */
    excludedUserIds: string[];
}

export const EMPTY_SOCIAL_FEED_FILTER: SocialFeedFilter = {
    extraRoomTypes: [],
    includedRoomIds: [],
    excludedRoomIds: [],
    excludedUserIds: [],
};

function asStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Reads the user's feed filter from their own account data — `EMPTY_SOCIAL_FEED_FILTER` when unset
 *  or malformed. */
export function loadSocialFeedFilter(client: MatrixClient): SocialFeedFilter {
    // matrix-js-sdk's getAccountData/setAccountData are typed against its own known
    // AccountDataEvents map, which has no entry for this app-specific event type — cast through
    // `any` rather than widen the SDK's own types.
    const content = client
        .getAccountData(SOCIAL_FEED_FILTER_EVENT_TYPE as any)
        ?.getContent<Record<string, unknown>>();
    if (!content) return EMPTY_SOCIAL_FEED_FILTER;
    return {
        extraRoomTypes: asStringArray(content.extraRoomTypes),
        includedRoomIds: asStringArray(content.includedRoomIds),
        excludedRoomIds: asStringArray(content.excludedRoomIds),
        excludedUserIds: asStringArray(content.excludedUserIds),
    };
}

export async function saveSocialFeedFilter(client: MatrixClient, filter: SocialFeedFilter): Promise<void> {
    await client.setAccountData(SOCIAL_FEED_FILTER_EVENT_TYPE as any, filter as any);
}

/** The room `type`s (built-in Social Rooms types plus any extras from the filter) that qualify a
 *  room as a feed source. */
export function getIncludedRoomTypes(filter: SocialFeedFilter): string[] {
    return [MSC4501_ROOM_TYPE_PROFILE, MSC4501_ROOM_TYPE_GROUP, ...filter.extraRoomTypes];
}

function roomMatchesIdOrAlias(room: Room, idOrAlias: string): boolean {
    if (room.roomId === idOrAlias) return true;
    if (room.getCanonicalAlias() === idOrAlias) return true;
    return room.getAltAliases().includes(idOrAlias);
}

/** True when a room's posts should be included in the feed under this filter: either its own
 *  `type` is one of the included room types, or it's explicitly listed in includedRoomIds —
 *  unless it's also explicitly excluded, which always wins over either form of inclusion (this
 *  also covers a user hand-editing their account data to list the same room in both). */
export function roomCountsForFeed(room: Room, filter: SocialFeedFilter): boolean {
    if (filter.excludedRoomIds.some((idOrAlias) => roomMatchesIdOrAlias(room, idOrAlias))) return false;

    if (filter.includedRoomIds.some((idOrAlias) => roomMatchesIdOrAlias(room, idOrAlias))) return true;

    const createEvent = room.currentState.getStateEvents("m.room.create", "");
    const type = (createEvent?.getContent() as { type?: string } | undefined)?.type;
    return !!type && getIncludedRoomTypes(filter).includes(type);
}

/** True when a post by this sender should be excluded from the feed under this filter. */
export function senderExcludedFromFeed(senderId: string | null, filter: SocialFeedFilter): boolean {
    return !!senderId && filter.excludedUserIds.includes(senderId);
}

// ---------------------------------------------------------------------------
// Validation (used by the filter modal before saving)
// ---------------------------------------------------------------------------

const ROOM_TYPE_RE = /^\S+$/;
const ROOM_ID_OR_ALIAS_RE = /^[!#][^\s:]+:\S+$/;
const USER_ID_RE = /^@[^\s:]+:\S+$/;

export function isValidRoomType(value: string): boolean {
    return ROOM_TYPE_RE.test(value);
}

export function isValidRoomIdOrAlias(value: string): boolean {
    return ROOM_ID_OR_ALIAS_RE.test(value);
}

export function isValidUserId(value: string): boolean {
    return USER_ID_RE.test(value);
}

/*
 * Haven - MSC4501's optional use of MSC4589 formatted display names for profile room names: a
 * profile room named after its owner shows the owner's formatted display name (custom emoji,
 * bold...) instead of its plain m.room.name, which can only hold the ":shortcode:" text.
 *
 * Only when the room and its owner are properly linked both ways: the room's profile_user_id state
 * event names the owner, and the owner's profile names the room as their profile room. And only
 * when the room's name is exactly the owner's plain display name, so the formatted name (whose text
 * MSC4589 requires to match that display name) never shows anything the plain name doesn't.
 */

import { EventType, type Room } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";

import {
    getFormattedDisplayNameHtml,
    renderFormattedDisplayName,
} from "../../framework/formattedDisplayName/formattedDisplayName";
import { type LiveUserProfile, useLiveUserProfile } from "./liveUserProfile";
import { getVerifiedProfileUserId, isProfileRoom } from "./room-classifier";

/**
 * The profile room's name as safe HTML, from its owner's formatted display name, or undefined to
 * show the plain room name. `ownerProfile` is the owner's global profile (see useLiveUserProfile).
 */
export function profileRoomNameHtml(
    room: Room,
    ownerId: string | undefined,
    ownerProfile: LiveUserProfile | null,
): string | undefined {
    if (!ownerId || !ownerProfile || !isProfileRoom(room) || getVerifiedProfileUserId(room) !== ownerId)
        return undefined;
    // The owner's profile has to name this room back.
    if (ownerProfile.profileRoom?.roomId !== room.roomId) return undefined;
    const name = room.currentState.getStateEvents(EventType.RoomName, "")?.getContent()?.name;
    if (typeof name !== "string" || !name) return undefined;

    // The owner's names in the room, or their global profile's if they aren't a member at all.
    const member = room.getMember(ownerId);
    if (member) {
        if (member.membership !== KnownMembership.Join) return undefined;
        const content = member.events.member?.getContent();
        if (content?.displayname !== name) return undefined;
        return getFormattedDisplayNameHtml(content, name);
    }
    if (ownerProfile.displayName !== name) return undefined;
    return renderFormattedDisplayName(ownerProfile.formattedDisplayName, name);
}

/** {@link profileRoomNameHtml} for any view of a room, looking its owner's global profile up. */
export function useProfileRoomNameHtml(room: Room): string | undefined {
    const ownerId = isProfileRoom(room) ? getVerifiedProfileUserId(room) : undefined;
    const ownerProfile = useLiveUserProfile(room.client, ownerId);
    return profileRoomNameHtml(room, ownerId, ownerProfile);
}

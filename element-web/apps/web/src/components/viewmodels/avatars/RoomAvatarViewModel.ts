/*
 * Copyright 2025 New Vector Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { type Room, RoomEvent } from "matrix-js-sdk/src/matrix";

import { useTypedEventEmitterState } from "../../../hooks/useEventEmitter";
import { useDmMember, usePresence, type Presence } from "../../views/avatars/WithPresenceIndicator";
import { DefaultTagID } from "../../../stores/room-list-v3/skip-list/tag";

export enum AvatarBadgeDecoration {
    LowPriority = "LowPriority",
    VideoRoom = "VideoRoom",
    Presence = "Presence",
}

export interface RoomAvatarViewState {
    /**
     * The presence of the user in the DM room.
     * If null, the user is not in a DM room or presence is not enabled.
     */
    presence: Presence | null;

    /**
     * The decoration that should be rendered.
     */
    badgeDecoration?: AvatarBadgeDecoration;
}

/**
 * Hook to get the state of the room avatar.
 * @param room
 */
export function useRoomAvatarViewModel(room: Room): RoomAvatarViewState {
    const isVideoRoom = room.isElementVideoRoom() || room.isCallRoom();
    const roomMember = useDmMember(room);
    const presence = usePresence(room, roomMember);
    const isLowPriority = useTypedEventEmitterState(room, RoomEvent.Tags, () => !!room.tags[DefaultTagID.LowPriority]);

    let badgeDecoration: AvatarBadgeDecoration | undefined;
    if (isLowPriority) {
        badgeDecoration = AvatarBadgeDecoration.LowPriority;
    } else if (isVideoRoom) {
        badgeDecoration = AvatarBadgeDecoration.VideoRoom;
    } else if (presence) {
        badgeDecoration = AvatarBadgeDecoration.Presence;
    }

    return { badgeDecoration, presence };
}

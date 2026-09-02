/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import { type RoomMember } from "matrix-js-sdk/src/matrix";

import MemberAvatar from "../../avatars/MemberAvatar";
import { type EventTileSenderSnapshot } from "../../../../viewmodels/room/timeline/event-tile/EventTileViewModel";
import { type PerMessageProfile, resolvePerMessageAvatarUrl } from "../../../../utils/PerMessageProfile";

/**
 * Props for the {@link EventTileAvatarAdapter} component.
 */
interface EventTileAvatarAdapterProps {
    /** Room member whose avatar is being rendered. */
    avatarMember: RoomMember | null;
    /** Snapshot of the sender identity state for this tile. */
    senderSnapshot: EventTileSenderSnapshot;
    /** Haven: MSC4144 per-message profile for this event, if any. */
    perMessageProfile?: PerMessageProfile;
}

/**
 * Renders the sender avatar for an event tile.
 */
export function EventTileAvatarAdapter({
    avatarMember,
    senderSnapshot,
    perMessageProfile,
}: Readonly<EventTileAvatarAdapterProps>): JSX.Element | null {
    const { avatarSize } = senderSnapshot.profileState;

    if (!avatarMember || avatarSize === null) {
        return null;
    }

    return (
        <div className="mx_EventTile_avatar">
            <MemberAvatar
                member={avatarMember}
                size={avatarSize}
                viewUserOnClick={senderSnapshot.viewUserOnClick}
                forceHistorical={senderSnapshot.forceHistoricalAvatar}
                overrideName={perMessageProfile?.displayname}
                overrideAvatarUrl={resolvePerMessageAvatarUrl(perMessageProfile)}
                overrideIdName={perMessageProfile?.id}
            />
        </div>
    );
}

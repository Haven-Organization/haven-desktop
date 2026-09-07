/*
Copyright 2025 New Vector Ltd.
SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE files in the repository root for full details.
*/

import { type Room, type RoomMember, type IPowerLevelsContent, EventType } from "matrix-js-sdk/src/matrix";

import { useMatrixClientContext } from "../../../../../contexts/MatrixClientContext";

/**
 * Interface used by admin tools container subcomponents props
 */
export interface RoomAdminToolsProps {
    room: Room;
    member: RoomMember;
    isUpdating: boolean;
    startUpdating: () => void;
    stopUpdating: () => void;
}

/**
 * Interface used by admin tools container props
 */
export interface RoomAdminToolsContainerProps {
    room: Room;
    member: RoomMember;
    powerLevels: IPowerLevelsContent;
}

interface UserInfoAdminToolsContainerState {
    shouldShowKickButton: boolean;
    shouldShowBanButton: boolean;
    shouldShowMuteButton: boolean;
    shouldShowRedactButton: boolean;
    isCurrentUserInTheRoom: boolean;
}

/**
 * The view model for the user info admin tools container
 * @param {RoomAdminToolsContainerProps} props - the object containing the necceray props for the view model
 * @param {Room} props.room - the room that display the admin tools
 * @param {RoomMember} props.member - the selected member
 * @param {IPowerLevelsContent} props.powerLevels - current room power levels
 * @returns {UserInfoAdminToolsContainerState} the user info admin tools container state
 */
export const useUserInfoAdminToolsContainerViewModel = (
    props: RoomAdminToolsContainerProps,
): UserInfoAdminToolsContainerState => {
    const cli = useMatrixClientContext();
    const { room, member, powerLevels } = props;

    const editPowerLevel =
        (powerLevels.events ? powerLevels.events["m.room.power_levels"] : null) || powerLevels.state_default;

    // if these do not exist in the event then they should default to 50 as per the spec
    const { ban: banPowerLevel = 50, kick: kickPowerLevel = 50, redact: redactPowerLevel = 50 } = powerLevels;

    const me = room.getMember(cli.getUserId() || "");
    const isCurrentUserInTheRoom = me !== null;

    if (!isCurrentUserInTheRoom) {
        return {
            shouldShowKickButton: false,
            shouldShowBanButton: false,
            shouldShowMuteButton: false,
            shouldShowRedactButton: false,
            isCurrentUserInTheRoom: false,
        };
    }

    const isMe = me.userId === member.userId;
    const canAffectUser = member.powerLevel < me.powerLevel || isMe;

    // Haven: redacting your OWN messages is governed by a separate, much more permissive rule than
    // the "redact" power level below (that one is specifically for redacting *other* members'
    // events - see RolesRoomSettingsTab's own "Remove messages sent by others" vs "Remove messages
    // sent by me"). Comparing against the stricter "redact" PL for the isMe case too meant this
    // button silently never appeared on your own profile card in any room using the spec's own
    // defaults (events_default 0, redact 50), even though you could already redact your own
    // messages there. maySendEvent(EventType.RoomRedaction, ...) is exactly that self-redaction
    // rule (events["m.room.redaction"], falling back to events_default) - same check RoomView.tsx's
    // own canSelfRedact uses.
    const canRedactOwnMessages = room.currentState.maySendEvent(EventType.RoomRedaction, me.userId);

    return {
        shouldShowKickButton: !isMe && canAffectUser && me.powerLevel >= kickPowerLevel,
        shouldShowRedactButton:
            !room.isSpaceRoom() && (isMe ? canRedactOwnMessages : me.powerLevel >= redactPowerLevel),
        shouldShowBanButton: !isMe && canAffectUser && me.powerLevel >= banPowerLevel,
        shouldShowMuteButton: !isMe && canAffectUser && me.powerLevel >= Number(editPowerLevel) && !room.isSpaceRoom(),
        isCurrentUserInTheRoom,
    };
};

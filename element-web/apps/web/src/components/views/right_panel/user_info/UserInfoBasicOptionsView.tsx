/*
Copyright 2025 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type RoomMember, type User, type Room } from "matrix-js-sdk/src/matrix";
import React, { type JSX, type ReactNode, useState } from "react";
import { MenuItem } from "@vector-im/compound-web";
import {
    ChatIcon,
    CheckIcon,
    MentionIcon,
    ShareIcon,
    InlineCodeIcon,
    DevicesIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";
import InviteIcon from "@vector-im/compound-design-tokens/assets/web/icons/user-add";
import RoomIcon from "@vector-im/compound-design-tokens/assets/web/icons/room";

import { _t } from "../../../../languageHandler";
import { useUserInfoBasicOptionsViewModel } from "../../../viewmodels/right_panel/user_info/UserInfoBasicOptionsViewModel";
import { Container, type Member, type IDevice } from "../UserInfo";
import { shouldShowComponent } from "../../../../customisations/helpers/UIComponents";
import { UIComponent } from "../../../../settings/UIFeature";
import SettingsStore from "../../../../settings/SettingsStore";
import Modal from "../../../../Modal";
import ViewProfileSource from "../../../structures/ViewProfileSource";
import UserDevicesDialog from "../../dialogs/UserDevicesDialog";
// haven apps-framework patch
import { useMatrixClientContext } from "../../../../contexts/MatrixClientContext";
import { formatMutualRoomCount, pickMutualRoomsIconRoom, useMutualRooms } from "../../../../utils/MutualRooms";
import MutualRoomsDialog from "../../dialogs/MutualRoomsDialog";
import RoomAvatar from "../../avatars/RoomAvatar";

/**
 * Haven: "X Mutual Rooms" - opens MutualRoomsDialog. Its icon is a mutual room's avatar (see
 * pickMutualRoomsIconRoom), or a generic room icon when none of them has one. Not rendered for
 * yourself, or until there is at least one mutual room.
 */
const MutualRoomsButton = ({ member, room }: { member: Member; room?: Room }): JSX.Element | null => {
    const client = useMatrixClientContext();
    const rooms = useMutualRooms(client, member.userId);
    if (!rooms?.length) return null;

    const iconRoom = pickMutualRoomsIconRoom(rooms, room?.roomId);
    const icon = iconRoom ? (
        <span className="mx_UserInfo_mutualRoomsIcon" aria-hidden="true">
            <RoomAvatar room={iconRoom} size="24px" />
        </span>
    ) : (
        RoomIcon
    );

    return (
        <MenuItem
            role="button"
            onSelect={(ev) => {
                ev.preventDefault();
                Modal.createDialog(MutualRoomsDialog, { rooms });
            }}
            label={_t("user_info|mutual_rooms_button", {
                count: rooms.length,
                formattedCount: formatMutualRoomCount(rooms.length),
            })}
            Icon={icon}
        />
    );
};

const MessageButton = ({
    member,
    openDMForUser,
}: {
    member: Member;
    openDMForUser: (user: Member) => Promise<void>;
}): JSX.Element => {
    const [busy, setBusy] = useState(false);

    return (
        <MenuItem
            role="button"
            onSelect={async (ev) => {
                ev.preventDefault();
                if (busy) return;
                setBusy(true);
                await openDMForUser(member);
                setBusy(false);
            }}
            disabled={busy}
            label={_t("user_info|send_message")}
            Icon={ChatIcon}
        />
    );
};

export const UserInfoBasicOptionsView: React.FC<{
    member: User | RoomMember;
    room: Room;
    devices: IDevice[];
    children?: ReactNode;
}> = ({ room, member, devices, children }) => {
    const vm = useUserInfoBasicOptionsViewModel(room, member);

    let insertPillButton: JSX.Element | undefined;
    let inviteUserButton: JSX.Element | undefined;
    let readReceiptButton: JSX.Element | undefined;

    if (!vm.isMe) {
        readReceiptButton = (
            <MenuItem
                role="button"
                onSelect={async (ev) => {
                    ev.preventDefault();
                    vm.onReadReceiptButton();
                }}
                label={_t("user_info|jump_to_rr_button")}
                disabled={vm.readReceiptButtonDisabled}
                Icon={CheckIcon}
            />
        );

        if (vm.showInsertPillButton) {
            insertPillButton = (
                <MenuItem
                    role="button"
                    onSelect={async (ev) => {
                        ev.preventDefault();
                        vm.onInsertPillButton();
                    }}
                    label={_t("action|mention")}
                    Icon={MentionIcon}
                />
            );
        }

        if (vm.showInviteButton && shouldShowComponent(UIComponent.InviteUsers)) {
            inviteUserButton = (
                <MenuItem
                    role="button"
                    onSelect={async (ev) => {
                        ev.preventDefault();
                        void vm.onInviteUserButton(room.roomId, ev);
                    }}
                    label={_t("action|invite")}
                    Icon={InviteIcon}
                />
            );
        }
    }

    const shareUserButton = (
        <MenuItem
            role="button"
            onSelect={async (ev) => {
                ev.preventDefault();
                vm.onShareUserClick();
            }}
            label={_t("user_info|share_button")}
            Icon={ShareIcon}
        />
    );

    const directMessageButton =
        vm.isMe || !shouldShowComponent(UIComponent.CreateRooms) ? null : (
            <MessageButton member={member} openDMForUser={vm.onOpenDmForUser} />
        );

    const viewDevicesButton = SettingsStore.getValue("developerMode") ? (
        <MenuItem
            role="button"
            onSelect={async (ev) => {
                ev.preventDefault();
                Modal.createDialog(UserDevicesDialog, { devices });
            }}
            label={_t("user_info|view_devices_button", { count: devices.length })}
            Icon={DevicesIcon}
        />
    ) : null;

    const viewProfileDataButton = SettingsStore.getValue("developerMode") ? (
        <MenuItem
            role="button"
            onSelect={async (ev) => {
                ev.preventDefault();
                Modal.createDialog(ViewProfileSource, { userId: member.userId }, "mx_Dialog_viewsource");
            }}
            label={_t("user_info|view_profile_data_button")}
            Icon={InlineCodeIcon}
        />
    ) : null;

    return (
        <Container>
            {children}
            {directMessageButton}
            {inviteUserButton}
            {readReceiptButton}
            {shareUserButton}
            {insertPillButton}
            {/* haven apps-framework patch */}
            {!vm.isMe && <MutualRoomsButton member={member} room={room} />}
            {viewDevicesButton}
            {viewProfileDataButton}
        </Container>
    );
};

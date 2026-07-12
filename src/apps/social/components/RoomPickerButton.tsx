/*
 * Social Overlay — RoomPickerButton
 *
 * Replaces the old <select>-style room-picker dropdown with a button (room avatar + name, plus a
 * trailing chevron — the same "click to open a picker" convention used elsewhere, e.g. stock
 * dropdowns) that opens RoomPickerModal on click — a fork of Element's own ForwardDialog room list.
 */

import React, { type JSX, useCallback } from "react";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import { ChevronDownIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import Modal from "../../../../element-web/apps/web/src/Modal";
import RoomAvatar from "../../../../element-web/apps/web/src/components/views/avatars/RoomAvatar";
import AccessibleButton from "../../../../element-web/apps/web/src/components/views/elements/AccessibleButton";
import { RoomPickerModal } from "./RoomPickerModal";

interface Props {
    client: MatrixClient;
    value: string;
    /** The user's own profile room, if any — shown as "Your Profile" rather than its raw room name. */
    myProfileRoomId?: string | null;
    onChange: (roomId: string) => void;
}

export function RoomPickerButton({ client, value, myProfileRoomId, onChange }: Props): JSX.Element {
    const room = value ? client.getRoom(value) : null;
    const label = room ? (value === myProfileRoomId ? "Your Profile" : room.name) : "Select a room";

    const openPicker = useCallback(() => {
        const { finished } = Modal.createDialog(RoomPickerModal, { client }, "social_RoomPickerModal_wrapper");
        finished.then(([roomId]: [string?]) => {
            if (roomId) onChange(roomId);
        });
    }, [client, onChange]);

    return (
        <AccessibleButton className="social_RoomPickerButton" onClick={openPicker}>
            {room && <RoomAvatar room={room} size="22px" />}
            <span className="social_RoomPickerButton_label">{label}</span>
            <ChevronDownIcon className="social_RoomPickerButton_chevron" width="16px" height="16px" />
        </AccessibleButton>
    );
}

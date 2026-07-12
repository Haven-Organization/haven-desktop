/*
Copyright 2019-2025 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type ContextType } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";

import { _t } from "../../../../../languageHandler";
import RoomProfileSettings from "../../../room_settings/RoomProfileSettings";
import AccessibleButton, { type ButtonEvent } from "../../../elements/AccessibleButton";
import dis from "../../../../../dispatcher/dispatcher";
import Modal from "../../../../../Modal";
import QuestionDialog from "../../../dialogs/QuestionDialog";
import ErrorDialog from "../../../dialogs/ErrorDialog";
import MatrixClientContext from "../../../../../contexts/MatrixClientContext";
import AliasSettings from "../../../room_settings/AliasSettings";
import PosthogTrackers from "../../../../../PosthogTrackers";
import { SettingsSubsection } from "../../shared/SettingsSubsection";
import SettingsTab from "../SettingsTab";
import { SettingsSection } from "../../shared/SettingsSection";
import { MediaPreviewAccountSettings } from "../user/MediaPreviewAccountSettings";
import { isProfileRoom, socialRoomKind } from "../../../../../../../../../src/apps/social/utils/room-classifier";
import { clearProfileRoomLink } from "../../../../../../../../../src/apps/social/utils/social-actions";

interface IProps {
    room: Room;
}

interface IState {
    isRoomPublished: boolean;
}

export default class GeneralRoomSettingsTab extends React.Component<IProps, IState> {
    public static contextType = MatrixClientContext;
    declare public context: ContextType<typeof MatrixClientContext>;

    public constructor(props: IProps) {
        super(props);

        this.state = {
            isRoomPublished: false, // loaded async
        };
    }

    private onLeaveClick = (ev: ButtonEvent): void => {
        dis.dispatch({
            action: "leave_room",
            room_id: this.props.room.roomId,
        });

        PosthogTrackers.trackInteraction("WebRoomSettingsLeaveButton", ev);
    };

    private onUnlinkProfileClick = (): void => {
        // Modal.createDialog silently discards an `onFinished` passed in props — it overrides it
        // with its own internal close handler (see Modal.tsx's buildModal: `<Component {...props}
        // onFinished={closeDialog} />`, where the spread order means the real onFinished always
        // wins). The result is only ever delivered via the returned `finished` promise — see
        // SecurityRoomSettingsTab's onBeforeJoinRuleChange for the same established pattern. An
        // earlier version of this handler passed `onFinished` in props, which meant clicking
        // either button in the confirm dialog was a complete no-op — nothing to catch, nothing to
        // log, because the callback was never invoked at all.
        const { finished } = Modal.createDialog(QuestionDialog, {
            title: "Unlink profile",
            description:
                "This will unlink this room as your profile. You'll stay in the room, but it will no longer be recognized as your Social profile.",
            button: "Unlink Profile",
            danger: true,
        });
        finished.then(([proceed]: [boolean?]) => {
            if (!proceed) return;
            clearProfileRoomLink(this.context).catch((err: Error) => {
                Modal.createDialog(ErrorDialog, {
                    title: "Failed to unlink profile",
                    description: err.message || "The server rejected the request. See console for details.",
                });
            });
        });
    };

    public render(): React.ReactNode {
        const client = this.context;
        const room = this.props.room;

        const canSetAliases = true; // Previously, we arbitrarily only allowed admins to do this
        const canSetCanonical = room.currentState.mayClientSendStateEvent("m.room.canonical_alias", client);
        const canonicalAliasEv = room.currentState.getStateEvents("m.room.canonical_alias", "") ?? undefined;

        const profileRoomCreator = room.currentState.getStateEvents("m.room.create", "")?.getSender();
        const isOwnProfileRoom = isProfileRoom(room) && profileRoomCreator === client.getUserId();

        let unlinkProfileSection;
        if (isOwnProfileRoom) {
            unlinkProfileSection = (
                <SettingsSubsection heading="Unlink Profile">
                    <AccessibleButton kind="danger" onClick={this.onUnlinkProfileClick}>
                        Unlink Profile
                    </AccessibleButton>
                </SettingsSubsection>
            );
        }

        // haven apps-framework patch: "Leave room"/"Room Addresses" -> "Leave profile"/"Profile
        // Addresses" (or the group equivalents) for a Social room, matching the same word-for-word
        // swap applied throughout this dialog for Social rooms - unchanged for a regular room.
        const kind = socialRoomKind(room);
        const leaveLabel = kind === "profile" ? "Leave profile" : kind === "group" ? "Leave group" : _t("action|leave_room");
        const aliasesSectionHeading =
            kind === "profile"
                ? "Profile Addresses"
                : kind === "group"
                  ? "Group Addresses"
                  : _t("room_settings|general|aliases_section");

        let leaveSection;
        if (room.getMyMembership() === KnownMembership.Join) {
            leaveSection = (
                <SettingsSubsection heading={leaveLabel}>
                    <AccessibleButton kind="danger" onClick={this.onLeaveClick}>
                        {leaveLabel}
                    </AccessibleButton>
                </SettingsSubsection>
            );
        }

        return (
            <SettingsTab data-testid="General">
                <SettingsSection heading={_t("common|general")}>
                    <RoomProfileSettings roomId={room.roomId} />
                </SettingsSection>

                <SettingsSection heading={aliasesSectionHeading}>
                    <AliasSettings
                        roomId={room.roomId}
                        canSetCanonicalAlias={canSetCanonical}
                        canSetAliases={canSetAliases}
                        canonicalAliasEvent={canonicalAliasEv}
                    />
                </SettingsSection>

                <SettingsSection heading={_t("room_settings|general|other_section")}>
                    <SettingsSubsection heading={_t("common|moderation_and_safety")} legacy={false}>
                        <MediaPreviewAccountSettings roomId={room.roomId} />
                    </SettingsSubsection>
                    {unlinkProfileSection}
                    {leaveSection}
                </SettingsSection>
            </SettingsTab>
        );
    }
}

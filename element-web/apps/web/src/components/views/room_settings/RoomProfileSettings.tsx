/*
Copyright 2019-2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { createRef } from "react";
import classNames from "classnames";
import { ContentHelpers, EventType, type Room } from "matrix-js-sdk/src/matrix";

import { _t } from "../../../languageHandler";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import Field from "../elements/Field";
import AccessibleButton, { type ButtonEvent } from "../elements/AccessibleButton";
import AvatarSetting from "../settings/AvatarSetting";
import { htmlSerializeFromMdIfNeeded } from "../../../editor/serialize";
import DMRoomMap from "../../../utils/DMRoomMap";
import { LocalRoom } from "../../../models/LocalRoom";
import { ROOM_BANNER_EVENT_TYPE, socialRoomKind } from "../../../../../../../src/apps/social/utils/room-classifier";
import { BannerSetting } from "../../../../../../../src/apps/social/components/BannerSetting";

interface IProps {
    roomId: string;
}

interface IState {
    originalDisplayName: string;
    displayName: string;
    originalAvatarUrl: string | null;
    avatarFile: File | null;
    // If true, the user has indicated that they wish to remove the avatar and this should happen on save.
    avatarRemovalPending: boolean;
    originalBannerUrl: string | null;
    bannerFile: File | null;
    // If true, the user has indicated that they wish to remove the banner and this should happen on save.
    bannerRemovalPending: boolean;
    originalTopic: string;
    topic: string;
    profileFieldsTouched: Record<string, boolean>;
    canSetName: boolean;
    canSetTopic: boolean;
    canSetAvatar: boolean;
    canSetBanner: boolean;
}

function idNameForRoom(room: Room): string {
    const dmMapUserId = DMRoomMap.shared().getUserIdForRoomId(room.roomId);
    // If the room is a DM, we use the other user's ID for the color hash
    // in order to match the room avatar with their avatar
    if (dmMapUserId) return dmMapUserId;

    if (room instanceof LocalRoom && room.targets.length === 1) {
        return room.targets[0].userId;
    }

    return room.roomId;
}

// TODO: Merge with ProfileSettings?
export default class RoomProfileSettings extends React.Component<IProps, IState> {
    private avatarUpload = createRef<HTMLInputElement>();

    public constructor(props: IProps) {
        super(props);

        const client = MatrixClientPeg.safeGet();
        const room = client.getRoom(props.roomId);
        if (!room) throw new Error(`Expected a room for ID: ${props.roomId}`);

        const avatarEvent = room.currentState.getStateEvents(EventType.RoomAvatar, "");
        const avatarUrl = avatarEvent?.getContent()["url"] ?? null;

        const bannerEvent = room.currentState.getStateEvents(ROOM_BANNER_EVENT_TYPE as any, "");
        const bannerUrl = bannerEvent?.getContent()["url"] ?? null;

        const topicEvent = room.currentState.getStateEvents(EventType.RoomTopic, "");
        const topic = (topicEvent && ContentHelpers.parseTopicContent(topicEvent.getContent()).text) || "";

        const nameEvent = room.currentState.getStateEvents(EventType.RoomName, "");
        const name = nameEvent && nameEvent.getContent() ? nameEvent.getContent()["name"] : "";

        const userId = client.getSafeUserId();
        this.state = {
            originalDisplayName: name,
            displayName: name,
            originalAvatarUrl: avatarUrl,
            avatarFile: null,
            avatarRemovalPending: false,
            originalBannerUrl: bannerUrl,
            bannerFile: null,
            bannerRemovalPending: false,
            originalTopic: topic,
            topic: topic,
            profileFieldsTouched: {},
            canSetName: room.currentState.maySendStateEvent(EventType.RoomName, userId),
            canSetTopic: room.currentState.maySendStateEvent(EventType.RoomTopic, userId),
            canSetAvatar: room.currentState.maySendStateEvent(EventType.RoomAvatar, userId),
            canSetBanner: room.currentState.maySendStateEvent(ROOM_BANNER_EVENT_TYPE as any, userId),
        };
    }

    private onAvatarChanged = (file: File): void => {
        this.setState({
            avatarFile: file,
            avatarRemovalPending: false,
            profileFieldsTouched: {
                ...this.state.profileFieldsTouched,
                avatar: true,
            },
        });
    };

    private removeAvatar = (): void => {
        // clear file upload field so same file can be selected
        if (this.avatarUpload.current) this.avatarUpload.current.value = "";
        this.setState({
            avatarFile: null,
            avatarRemovalPending: true,
            profileFieldsTouched: {
                ...this.state.profileFieldsTouched,
                avatar: true,
            },
        });
    };

    private onBannerChanged = (file: File): void => {
        this.setState({
            bannerFile: file,
            bannerRemovalPending: false,
            profileFieldsTouched: {
                ...this.state.profileFieldsTouched,
                banner: true,
            },
        });
    };

    private removeBanner = (): void => {
        this.setState({
            bannerFile: null,
            bannerRemovalPending: true,
            profileFieldsTouched: {
                ...this.state.profileFieldsTouched,
                banner: true,
            },
        });
    };

    private isSaveEnabled = (): boolean => {
        return Boolean(Object.values(this.state.profileFieldsTouched).length);
    };

    private cancelProfileChanges = async (e: ButtonEvent): Promise<void> => {
        e.stopPropagation();
        e.preventDefault();

        if (!this.isSaveEnabled()) return;
        this.setState({
            profileFieldsTouched: {},
            displayName: this.state.originalDisplayName,
            topic: this.state.originalTopic,
            avatarFile: null,
            avatarRemovalPending: false,
            bannerFile: null,
            bannerRemovalPending: false,
        });
    };

    private saveProfile = async (e: React.FormEvent): Promise<void> => {
        e.stopPropagation();
        e.preventDefault();

        if (!this.isSaveEnabled()) return;
        this.setState({ profileFieldsTouched: {} });

        const client = MatrixClientPeg.safeGet();
        const newState: Partial<IState> = {};

        // TODO: What do we do about errors?
        const displayName = this.state.displayName.trim();
        if (this.state.originalDisplayName !== this.state.displayName) {
            await client.setRoomName(this.props.roomId, displayName);
            newState.originalDisplayName = displayName;
            newState.displayName = displayName;
        }

        if (this.state.avatarFile) {
            const { content_uri: uri } = await client.uploadContent(this.state.avatarFile);
            await client.sendStateEvent(this.props.roomId, EventType.RoomAvatar, { url: uri }, "");
            newState.originalAvatarUrl = uri;
            newState.avatarFile = null;
        } else if (this.state.avatarRemovalPending) {
            await client.sendStateEvent(this.props.roomId, EventType.RoomAvatar, {}, "");
            newState.avatarRemovalPending = false;
            newState.originalAvatarUrl = null;
        }

        if (this.state.bannerFile) {
            const { content_uri: uri } = await client.uploadContent(this.state.bannerFile);
            await client.sendStateEvent(
                this.props.roomId,
                ROOM_BANNER_EVENT_TYPE as any,
                { url: uri, info: { mimetype: this.state.bannerFile.type } },
                "",
            );
            newState.originalBannerUrl = uri;
            newState.bannerFile = null;
        } else if (this.state.bannerRemovalPending) {
            await client.sendStateEvent(this.props.roomId, ROOM_BANNER_EVENT_TYPE as any, {}, "");
            newState.bannerRemovalPending = false;
            newState.originalBannerUrl = null;
        }

        if (this.state.originalTopic !== this.state.topic) {
            const html = htmlSerializeFromMdIfNeeded(this.state.topic, { forceHTML: false });
            // XXX: Note that we deliberately send an empty string on an empty topic rather
            // than a clearer `undefined` value. Synapse still requires a string in a topic.
            await client.setRoomTopic(this.props.roomId, this.state.topic, html);
            newState.originalTopic = this.state.topic;
        }

        this.setState(newState as IState);
    };

    private onDisplayNameChanged = (e: React.ChangeEvent<HTMLInputElement>): void => {
        this.setState({ displayName: e.target.value });
        if (this.state.originalDisplayName === e.target.value) {
            this.setState({
                profileFieldsTouched: {
                    ...this.state.profileFieldsTouched,
                    name: false,
                },
            });
        } else {
            this.setState({
                profileFieldsTouched: {
                    ...this.state.profileFieldsTouched,
                    name: true,
                },
            });
        }
    };

    private onTopicChanged = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
        this.setState({ topic: e.target.value });
        if (this.state.originalTopic === e.target.value) {
            this.setState({
                profileFieldsTouched: {
                    ...this.state.profileFieldsTouched,
                    topic: false,
                },
            });
        } else {
            this.setState({
                profileFieldsTouched: {
                    ...this.state.profileFieldsTouched,
                    topic: true,
                },
            });
        }
    };

    public render(): React.ReactNode {
        // haven apps-framework patch: "Room Name"/"Room Topic"/"Room avatar" -> "Profile
        // Name"/"Profile Topic"/"Profile avatar" (or the group equivalents) for a Social room,
        // matching the same word-for-word swap applied throughout this dialog - unchanged for a
        // regular room.
        const kind = socialRoomKind(MatrixClientPeg.safeGet().getRoom(this.props.roomId)!);
        const nameFieldLabel =
            kind === "profile" ? "Profile Name" : kind === "group" ? "Group Name" : _t("room_settings|general|name_field_label");
        const topicFieldLabel =
            kind === "profile"
                ? "Profile Topic"
                : kind === "group"
                  ? "Group Topic"
                  : _t("room_settings|general|topic_field_label");
        const avatarFieldLabel =
            kind === "profile"
                ? "Profile avatar"
                : kind === "group"
                  ? "Group avatar"
                  : _t("room_settings|general|avatar_field_label");

        let profileSettingsButtons;
        if (this.state.canSetName || this.state.canSetTopic || this.state.canSetAvatar || this.state.canSetBanner) {
            profileSettingsButtons = (
                <div className="mx_RoomProfileSettings_buttons">
                    <AccessibleButton
                        onClick={this.cancelProfileChanges}
                        kind="primary_outline"
                        disabled={!this.isSaveEnabled()}
                    >
                        {_t("action|cancel")}
                    </AccessibleButton>
                    <AccessibleButton onClick={this.saveProfile} kind="primary" disabled={!this.isSaveEnabled()}>
                        {_t("action|save")}
                    </AccessibleButton>
                </div>
            );
        }

        const canRemove = this.state.profileFieldsTouched.avatar
            ? Boolean(this.state.avatarFile)
            : Boolean(this.state.originalAvatarUrl);

        const canRemoveBanner = this.state.profileFieldsTouched.banner
            ? Boolean(this.state.bannerFile)
            : Boolean(this.state.originalBannerUrl);

        return (
            <form onSubmit={this.saveProfile} autoComplete="off" noValidate={true} className="mx_RoomProfileSettings">
                <div className="mx_RoomProfileSettings_profile">
                    <div className="mx_RoomProfileSettings_profile_controls">
                        <Field
                            label={nameFieldLabel}
                            type="text"
                            value={this.state.displayName}
                            autoComplete="off"
                            onChange={this.onDisplayNameChanged}
                            disabled={!this.state.canSetName}
                        />
                        <Field
                            className={classNames(
                                "mx_RoomProfileSettings_profile_controls_topic",
                                "mx_RoomProfileSettings_profile_controls_topic--room",
                            )}
                            id="profileTopic" // See: NewRoomIntro.tsx
                            label={topicFieldLabel}
                            disabled={!this.state.canSetTopic}
                            type="text"
                            value={this.state.topic}
                            autoComplete="off"
                            onChange={this.onTopicChanged}
                            element="textarea"
                        />
                    </div>
                    <AvatarSetting
                        avatar={
                            this.state.avatarRemovalPending
                                ? undefined
                                : (this.state.avatarFile ?? this.state.originalAvatarUrl ?? undefined)
                        }
                        avatarAccessibleName={avatarFieldLabel}
                        disabled={!this.state.canSetAvatar}
                        onChange={this.onAvatarChanged}
                        removeAvatar={canRemove ? this.removeAvatar : undefined}
                        placeholderId={idNameForRoom(MatrixClientPeg.safeGet().getRoom(this.props.roomId)!)}
                        placeholderName={MatrixClientPeg.safeGet().getRoom(this.props.roomId)!.name}
                    />
                </div>
                <BannerSetting
                    banner={
                        this.state.bannerRemovalPending
                            ? undefined
                            : (this.state.bannerFile ?? this.state.originalBannerUrl ?? undefined)
                    }
                    disabled={!this.state.canSetBanner}
                    onChange={this.onBannerChanged}
                    removeBanner={canRemoveBanner ? this.removeBanner : undefined}
                />
                {profileSettingsButtons}
            </form>
        );
    }
}

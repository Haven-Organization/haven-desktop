/*
Copyright 2024 New Vector Ltd.
Copyright 2020, 2021 The Matrix.org Foundation C.I.C.
Copyright 2017 Michael Telatynski <7t3chguy@gmail.com>

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, {
    type JSX,
    type ChangeEvent,
    createRef,
    type KeyboardEvent,
    type SyntheticEvent,
    type ChangeEventHandler,
} from "react";
import { type Room, RoomType, JoinRule, Preset, Visibility } from "matrix-js-sdk/src/matrix";
import { Alert, Form, SettingsToggleInput } from "@vector-im/compound-web";

import SdkConfig from "../../../SdkConfig";
import withValidation, { type IFieldState, type IValidationResult } from "../elements/Validation";
import { _t } from "../../../languageHandler";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import { checkUserIsAllowedToChangeEncryption, type IOpts } from "../../../createRoom";
import Field from "../elements/Field";
import RoomAliasField from "../elements/RoomAliasField";
import DialogButtons from "../elements/DialogButtons";
import BaseDialog from "../dialogs/BaseDialog";
import JoinRuleDropdown from "../elements/JoinRuleDropdown";
import { getKeyBindingsManager } from "../../../KeyBindingsManager";
import { KeyBindingAction } from "../../../accessibility/KeyboardShortcuts";
import { privateShouldBeEncrypted } from "../../../utils/rooms";
import SettingsStore from "../../../settings/SettingsStore";
import { UIFeature } from "../../../settings/UIFeature";

interface IProps {
    type?: RoomType;
    defaultPublic?: boolean;
    defaultName?: string;
    parentSpace?: Room;
    defaultEncrypted?: boolean;
    defaultStateEncrypted?: boolean;
    /**
     * When set, this is really creating a Haven social profile/group room rather than a normal
     * room — swaps the title, visibility/public labels, join-rule copy, "ask to join" label, and
     * create-button label to talk about a "profile"/"group" instead of a "room". Leave unset for
     * the stock New Room flow — every string above defaults to its normal `_t(...)` value.
     */
    entityNoun?: "profile" | "group";
    /**
     * Haven: pre-selects Ask to Join (JoinRule.Knock) as the initial access value, instead of the
     * usual Public/Restricted/Invite fallback chain - see Social's own createSocialRoom.ts, the
     * only current caller.
     */
    defaultAskToJoin?: boolean;
    /**
     * Haven: shows the "Allow anyone to post" toggle (and, when Public + enabled, its spam-risk
     * warning) - Social-only, see createSocialRoom.ts. Left off entirely for the stock New Room
     * flow, which has no such concept.
     */
    showAllowAnyonePost?: boolean;
    onFinished(proceed?: false): void;
    onFinished(proceed: true, opts: IOpts): void;
}

interface IState {
    /**
     * The selected room join rule.
     */
    joinRule: JoinRule;
    /**
     * Indicates whether the created room should have public visibility (ie, it should be
     * shown in the public room list). Only applicable if `joinRule` == `JoinRule.Knock`.
     */
    isPublicKnockRoom: boolean;
    /**
     * Indicates whether end-to-end encryption is enabled for the room.
     */
    isEncrypted: boolean;
    /**
     * Indicates whether end-to-end state encryption is enabled for this room.
     * See MSC4362. Available if feature_msc4362_encrypted_state_events is enabled.
     */
    isStateEncrypted: boolean;
    /**
     * The room name.
     */
    name: string;
    /**
     * The room topic.
     */
    topic: string;
    /**
     * The room alias.
     */
    alias: string;
    /**
     * Indicates whether the details section is open.
     */
    detailsOpen: boolean;
    /**
     * Indicates whether federation is disabled for the room.
     */
    noFederate: boolean;
    /**
     * Indicates whether the room name is valid.
     */
    nameIsValid: boolean;
    /**
     * Indicates whether the user can change encryption settings for the room.
     */
    canChangeEncryption: boolean;
    /**
     * Haven: whether any member (rather than just those explicitly given permission) can send
     * messages in the room - only meaningful when showAllowAnyonePost is set. See
     * roomCreateOptions's own doc for how this becomes an actual power level.
     */
    allowAnyonePost: boolean;
}

export default class CreateRoomDialog extends React.Component<IProps, IState> {
    private readonly advancedSettingsEnabled: boolean;
    private readonly allowCreatingPublicRooms: boolean;
    private readonly supportsRestricted: boolean;
    private nameField = createRef<Field>();
    private aliasField = createRef<RoomAliasField>();

    public constructor(props: IProps) {
        super(props);

        this.advancedSettingsEnabled = SettingsStore.getValue(UIFeature.AdvancedSettings);
        this.allowCreatingPublicRooms = SettingsStore.getValue(UIFeature.AllowCreatingPublicRooms);

        this.supportsRestricted = !!this.props.parentSpace;
        const defaultPublic = this.allowCreatingPublicRooms && this.props.defaultPublic;

        let joinRule = JoinRule.Invite;
        if (this.props.defaultAskToJoin) {
            joinRule = JoinRule.Knock;
        } else if (defaultPublic) {
            joinRule = JoinRule.Public;
        } else if (this.supportsRestricted) {
            joinRule = JoinRule.Restricted;
        }

        const cli = MatrixClientPeg.safeGet();
        this.state = {
            isPublicKnockRoom: defaultPublic || false,
            isEncrypted: this.props.defaultEncrypted ?? privateShouldBeEncrypted(cli),
            isStateEncrypted: this.props.defaultStateEncrypted ?? false,
            joinRule,
            name: this.props.defaultName || "",
            topic: "",
            alias: "",
            detailsOpen: false,
            noFederate: SdkConfig.get().default_federate === false,
            nameIsValid: false,
            canChangeEncryption: false,
            // Haven: off by default - a newly created profile/group starts curated (only
            // explicitly-permitted members can post) until the owner opens it up.
            allowAnyonePost: false,
        };
    }

    private roomCreateOptions(): IOpts {
        const opts: IOpts = {};
        const createOpts: IOpts["createOpts"] = (opts.createOpts = {});
        opts.roomType = this.props.type;
        opts.name = this.state.name;

        if (this.state.joinRule === JoinRule.Public) {
            createOpts.visibility = Visibility.Public;
            createOpts.preset = Preset.PublicChat;
            opts.guestAccess = false;
            const { alias } = this.state;
            createOpts.room_alias_name = alias.substring(1, alias.indexOf(":"));
        } else {
            const encryptedStateFeature = SettingsStore.getValue("feature_msc4362_encrypted_state_events", null, false);

            opts.encryption = this.state.isEncrypted;
            opts.stateEncryption = encryptedStateFeature && this.state.isStateEncrypted;
        }

        if (this.state.topic) {
            opts.topic = this.state.topic;
        }
        if (this.state.noFederate) {
            createOpts.creation_content = { "m.federate": false };
        }

        opts.parentSpace = this.props.parentSpace;
        if (this.props.parentSpace && this.state.joinRule === JoinRule.Restricted) {
            opts.joinRule = JoinRule.Restricted;
        }

        if (this.state.joinRule === JoinRule.Knock) {
            opts.joinRule = JoinRule.Knock;
            createOpts.visibility = this.state.isPublicKnockRoom ? Visibility.Public : Visibility.Private;
        }

        // Haven: when "Allow anyone to post" is off, only members explicitly given permission
        // (power level >= 10) can send messages - everyone else can still read/react/join. See
        // IState.allowAnyonePost's own doc.
        if (this.props.showAllowAnyonePost && !this.state.allowAnyonePost) {
            createOpts.power_level_content_override = {
                ...createOpts.power_level_content_override,
                events_default: 10,
            };
        }

        return opts;
    }

    public componentDidMount(): void {
        const cli = MatrixClientPeg.safeGet();
        checkUserIsAllowedToChangeEncryption(cli, Preset.PrivateChat).then(({ allowChange, forcedValue }) =>
            this.setState((state) => ({
                canChangeEncryption: allowChange,
                // override with forcedValue if it is set
                isEncrypted: forcedValue ?? state.isEncrypted,
            })),
        );

        // move focus to first field when showing dialog
        this.nameField.current?.focus();
    }

    private onKeyDown = (event: KeyboardEvent): void => {
        const action = getKeyBindingsManager().getAccessibilityAction(event);
        switch (action) {
            case KeyBindingAction.Enter:
                this.onOk();
                event.preventDefault();
                event.stopPropagation();
                break;
        }
    };

    private onOk = async (): Promise<void> => {
        if (!this.nameField.current) return;
        const activeElement = document.activeElement as HTMLElement;
        activeElement?.blur();
        await this.nameField.current.validate({ allowEmpty: false });
        if (this.aliasField.current) {
            await this.aliasField.current.validate({ allowEmpty: false });
        }
        // Validation and state updates are async, so we need to wait for them to complete
        // first. Queue a `setState` callback and wait for it to resolve.
        await new Promise<void>((resolve) => this.setState({}, resolve));
        if (this.state.nameIsValid && (!this.aliasField.current || this.aliasField.current.isValid)) {
            this.props.onFinished(true, this.roomCreateOptions());
        } else {
            let field: RoomAliasField | Field | null = null;
            if (!this.state.nameIsValid) {
                field = this.nameField.current;
            } else if (this.aliasField.current && !this.aliasField.current.isValid) {
                field = this.aliasField.current;
            }
            if (field) {
                field.focus();
                await field.validate({ allowEmpty: false, focused: true });
            }
        }
    };

    private onCancel = (): void => {
        this.props.onFinished(false);
    };

    private onNameChange = (ev: ChangeEvent<HTMLInputElement>): void => {
        this.setState({ name: ev.target.value });
    };

    private onTopicChange = (ev: ChangeEvent<HTMLInputElement>): void => {
        this.setState({ topic: ev.target.value });
    };

    private onJoinRuleChange = (joinRule: JoinRule): void => {
        this.setState({ joinRule });
    };

    private onEncryptedChange: ChangeEventHandler<HTMLInputElement> = (evt): void => {
        this.setState({ isEncrypted: evt.target.checked });
    };

    private onStateEncryptedChange: ChangeEventHandler<HTMLInputElement> = (evt): void => {
        this.setState({ isStateEncrypted: evt.target.checked });
    };

    private onAliasChange = (alias: string): void => {
        this.setState({ alias });
    };

    private onDetailsToggled = (ev: SyntheticEvent<HTMLDetailsElement>): void => {
        this.setState({ detailsOpen: (ev.target as HTMLDetailsElement).open });
    };

    private onNoFederateChange: ChangeEventHandler<HTMLInputElement> = (evt): void => {
        this.setState({ noFederate: evt.target.checked });
    };

    private onNameValidate = async (fieldState: IFieldState): Promise<IValidationResult> => {
        const result = await this.validateRoomName(fieldState);
        this.setState({ nameIsValid: !!result.valid });
        return result;
    };

    private onIsPublicKnockRoomChange: ChangeEventHandler<HTMLInputElement> = (evt): void => {
        this.setState({ isPublicKnockRoom: evt.target.checked });
    };

    private onAllowAnyonePostChange: ChangeEventHandler<HTMLInputElement> = (evt): void => {
        this.setState({ allowAnyonePost: evt.target.checked });
    };

    private validateRoomName = withValidation({
        rules: [
            {
                key: "required",
                test: async ({ value }) => !!value,
                invalid: () =>
                    this.props.entityNoun === "profile"
                        ? _t("create_room|name_validation_required_profile")
                        : this.props.entityNoun === "group"
                          ? _t("create_room|name_validation_required_group")
                          : _t("create_room|name_validation_required"),
            },
        ],
    });

    public render(): React.ReactNode {
        const isVideoRoom = this.props.type === RoomType.ElementVideo || this.props.type === RoomType.UnstableCall;

        let aliasField: JSX.Element | undefined;
        if (this.state.joinRule === JoinRule.Public) {
            const domain = MatrixClientPeg.safeGet().getDomain()!;
            aliasField = (
                <div className="mx_CreateRoomDialog_aliasContainer">
                    <RoomAliasField
                        ref={this.aliasField}
                        onChange={this.onAliasChange}
                        domain={domain}
                        value={this.state.alias}
                        label={this.props.entityNoun === "profile" ? _t("create_room|alias_heading_profile") : undefined}
                    />
                </div>
            );
        }

        let publicPrivateLabel: JSX.Element | undefined;
        if (this.state.joinRule === JoinRule.Restricted) {
            publicPrivateLabel = (
                <p>
                    {_t(
                        "create_room|join_rule_restricted_label",
                        {},
                        {
                            SpaceName: () => (
                                <strong>{this.props.parentSpace?.name ?? _t("common|unnamed_space")}</strong>
                            ),
                        },
                    )}
                    &nbsp;
                    {_t(this.props.entityNoun === "profile" ? "create_room|join_rule_change_notice_profile" : "create_room|join_rule_change_notice")}
                </p>
            );
        } else if (this.state.joinRule === JoinRule.Public && this.props.parentSpace) {
            publicPrivateLabel = (
                <p>
                    {_t(
                        "create_room|join_rule_public_parent_space_label",
                        {},
                        {
                            SpaceName: () => (
                                <strong>{this.props.parentSpace?.name ?? _t("common|unnamed_space")}</strong>
                            ),
                        },
                    )}
                    &nbsp;
                    {_t(this.props.entityNoun === "profile" ? "create_room|join_rule_change_notice_profile" : "create_room|join_rule_change_notice")}
                </p>
            );
        } else if (this.state.joinRule === JoinRule.Public) {
            publicPrivateLabel = (
                <p>
                    {this.props.entityNoun === "profile"
                        ? _t("create_room|join_rule_public_label_profile")
                        : this.props.entityNoun === "group"
                          ? _t("create_room|join_rule_public_label_group")
                          : _t("create_room|join_rule_public_label")}
                    &nbsp;
                    {_t(this.props.entityNoun === "profile" ? "create_room|join_rule_change_notice_profile" : "create_room|join_rule_change_notice")}
                </p>
            );
        } else if (this.state.joinRule === JoinRule.Invite) {
            publicPrivateLabel = (
                <p>
                    {this.props.entityNoun === "profile"
                        ? _t("create_room|join_rule_invite_label_profile")
                        : this.props.entityNoun === "group"
                          ? _t("create_room|join_rule_invite_label_group")
                          : _t("create_room|join_rule_invite_label")}
                    &nbsp;
                    {_t(this.props.entityNoun === "profile" ? "create_room|join_rule_change_notice_profile" : "create_room|join_rule_change_notice")}
                </p>
            );
        } else if (this.state.joinRule === JoinRule.Knock) {
            publicPrivateLabel = (
                <p>
                    {this.props.entityNoun === "profile"
                        ? _t("create_room|join_rule_knock_label_profile")
                        : _t("create_room|join_rule_knock_label")}
                </p>
            );
        }

        let visibilitySection: JSX.Element | undefined;
        if (this.state.joinRule === JoinRule.Knock) {
            visibilitySection = (
                <SettingsToggleInput
                    name="publish-room"
                    className="mx_CreateRoomDialog_labelledCheckbox"
                    label={_t("room_settings|security|publish_room")}
                    onChange={this.onIsPublicKnockRoomChange}
                    checked={this.state.isPublicKnockRoom}
                />
            );
        }

        let e2eeSection: JSX.Element | undefined;
        if (this.state.joinRule !== JoinRule.Public) {
            let microcopy: string;
            if (privateShouldBeEncrypted(MatrixClientPeg.safeGet())) {
                if (this.state.canChangeEncryption) {
                    microcopy = isVideoRoom
                        ? _t("create_room|encrypted_video_room_warning")
                        : _t("create_room|encrypted_warning");
                } else {
                    microcopy = _t("create_room|encryption_forced");
                }
            } else {
                microcopy = _t("settings|security|e2ee_default_disabled_warning");
            }
            e2eeSection = (
                <SettingsToggleInput
                    name="encryption-toggle"
                    label={_t("create_room|encryption_label")}
                    onChange={this.onEncryptedChange}
                    checked={this.state.isEncrypted}
                    disabled={!this.state.canChangeEncryption}
                    helpMessage={microcopy}
                />
            );
        }

        let e2eeStateSection: JSX.Element | undefined;
        if (
            SettingsStore.getValue("feature_msc4362_encrypted_state_events", null, false) &&
            this.state.joinRule !== JoinRule.Public
        ) {
            let microcopy: string;
            if (!this.state.canChangeEncryption) {
                microcopy = _t("create_room|encryption_forced");
            } else {
                microcopy = _t("create_room|state_encrypted_warning");
            }
            e2eeStateSection = (
                <SettingsToggleInput
                    name="state-encryption-toggle"
                    label={_t("create_room|state_encryption_label")}
                    onChange={this.onStateEncryptedChange}
                    checked={this.state.isStateEncrypted}
                    disabled={!this.state.canChangeEncryption}
                    helpMessage={microcopy}
                />
            );
        }

        let allowAnyonePostSection: JSX.Element | undefined;
        let spamWarningSection: JSX.Element | undefined;
        if (this.props.showAllowAnyonePost) {
            allowAnyonePostSection = (
                <SettingsToggleInput
                    name="allow-anyone-post"
                    label={_t("create_room|allow_anyone_to_post")}
                    onChange={this.onAllowAnyonePostChange}
                    checked={this.state.allowAnyonePost}
                    helpMessage={_t("create_room|allow_anyone_to_post_description")}
                />
            );

            if (this.state.joinRule === JoinRule.Public && this.state.allowAnyonePost) {
                spamWarningSection = (
                    <Alert type="critical" title={_t("create_room|public_open_posting_warning_title")}>
                        {_t("create_room|public_open_posting_warning")}
                    </Alert>
                );
            }
        }

        const isProfile = this.props.entityNoun === "profile";
        let federateLabel = _t(
            isProfile ? "create_room|unfederated_label_default_off_profile" : "create_room|unfederated_label_default_off",
        );
        if (SdkConfig.get().default_federate === false) {
            // We only change the label if the default setting is different to avoid jarring text changes to the
            // user. They will have read the implications of turning this off/on, so no need to rephrase for them.
            federateLabel = _t(
                isProfile ? "create_room|unfederated_label_default_on_profile" : "create_room|unfederated_label_default_on",
            );
        }

        let title: string;
        if (this.props.entityNoun === "profile") {
            title = _t("create_room|title_profile");
        } else if (this.props.entityNoun === "group") {
            title = _t("create_room|title_group");
        } else if (isVideoRoom) {
            title = _t("create_room|title_video_room");
        } else if (this.props.parentSpace || this.state.joinRule === JoinRule.Knock) {
            title = _t("action|create_a_room");
        } else {
            title =
                this.state.joinRule === JoinRule.Public
                    ? _t("create_room|title_public_room")
                    : _t("create_room|title_private_room");
        }

        return (
            <BaseDialog
                className="mx_CreateRoomDialog"
                onFinished={this.props.onFinished}
                title={title}
                screenName="CreateRoom"
            >
                <div className="mx_Dialog_content">
                    <Form.Root onSubmit={this.onOk} onKeyDown={this.onKeyDown}>
                        <Field
                            ref={this.nameField}
                            label={_t("common|name")}
                            onChange={this.onNameChange}
                            onValidate={this.onNameValidate}
                            value={this.state.name}
                            className="mx_CreateRoomDialog_name"
                        />
                        <Field
                            label={_t("create_room|topic_label")}
                            onChange={this.onTopicChange}
                            value={this.state.topic}
                            className="mx_CreateRoomDialog_topic"
                        />

                        <div>
                            <JoinRuleDropdown
                                label={
                                    this.props.entityNoun === "profile"
                                        ? _t("create_room|visibility_label_profile")
                                        : this.props.entityNoun === "group"
                                          ? _t("create_room|visibility_label_group")
                                          : _t("create_room|room_visibility_label")
                                }
                                labelInvite={
                                    this.props.entityNoun === "profile"
                                        ? _t("create_room|join_rule_invite_profile")
                                        : this.props.entityNoun === "group"
                                          ? _t("create_room|join_rule_invite_group")
                                          : _t("create_room|join_rule_invite")
                                }
                                labelKnock={
                                    this.props.entityNoun === "profile"
                                        ? _t("create_room|ask_to_follow")
                                        : _t("room_settings|security|join_rule_knock")
                                }
                                labelPublic={
                                    this.allowCreatingPublicRooms
                                        ? this.props.entityNoun === "profile"
                                            ? _t("create_room|public_profile")
                                            : this.props.entityNoun === "group"
                                              ? _t("create_room|public_group")
                                              : _t("common|public_room")
                                        : undefined
                                }
                                labelRestricted={
                                    this.supportsRestricted ? _t("create_room|join_rule_restricted") : undefined
                                }
                                value={this.state.joinRule}
                                onChange={this.onJoinRuleChange}
                            />

                            {publicPrivateLabel}
                        </div>

                        {visibilitySection}
                        {allowAnyonePostSection}
                        {spamWarningSection}
                        {e2eeSection}
                        {e2eeStateSection}
                        {aliasField}
                        {this.advancedSettingsEnabled && (
                            <details onToggle={this.onDetailsToggled} className="mx_CreateRoomDialog_details">
                                <summary className="mx_CreateRoomDialog_details_summary">
                                    {this.state.detailsOpen ? _t("action|hide_advanced") : _t("action|show_advanced")}
                                </summary>
                                <SettingsToggleInput
                                    name="unfederated"
                                    label={_t(isProfile ? "create_room|unfederated_profile" : "create_room|unfederated", {
                                        serverName: MatrixClientPeg.safeGet().getDomain(),
                                    })}
                                    onChange={this.onNoFederateChange}
                                    checked={this.state.noFederate}
                                    helpMessage={federateLabel}
                                />
                            </details>
                        )}
                    </Form.Root>
                </div>
                <DialogButtons
                    primaryButton={
                        this.props.entityNoun === "profile"
                            ? _t("create_room|action_create_profile")
                            : this.props.entityNoun === "group"
                              ? _t("create_room|action_create_group")
                              : isVideoRoom
                                ? _t("create_room|action_create_video_room")
                                : _t("create_room|action_create_room")
                    }
                    onPrimaryButtonClick={this.onOk}
                    onCancel={this.onCancel}
                />
            </BaseDialog>
        );
    }
}

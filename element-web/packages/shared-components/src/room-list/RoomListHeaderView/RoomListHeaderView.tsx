/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX, type ReactElement } from "react";
import { IconButton, H1 } from "@vector-im/compound-web";
import { CollapseAllIcon, ExpandAllIcon, ChatIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import { type ViewModel, useViewModel } from "../../core/viewmodel";
import { Flex } from "../../core/utils/Flex";
import { useI18n } from "../../core/i18n/i18nContext";
import { ComposeMenuView, SpaceMenuView, SpaceSwitcherMenu } from "./menu";
import { type NotificationDecorationData } from "../VirtualizedRoomListView/RoomListItemWrapper/RoomListItemView";
import styles from "./RoomListHeaderView.module.css";

/**
 * The available sorting options for the room list. Haven: sorting is a per-section preference
 * (see RoomListSectionHeaderView) rather than a global one - this type still lives here since
 * it's shared between the two.
 */
export type SortOption = "recent" | "alphabetical" | "unread-first";

/**
 * The available options for collapsing sections in the room list.
 */
export type CollapseSectionsOption = "collapse" | "expand";

export interface RoomListHeaderViewSnapshot {
    /**
     * The title of the room list
     */
    title: string;
    /**
     * Whether to display the space menu
     * True if there is an active space
     */
    displaySpaceMenu: boolean;
    /**
     * Whether the user can create rooms
     */
    canCreateRoom: boolean;
    /**
     * Whether the user can create video rooms
     */
    canCreateVideoRoom: boolean;
    /**
     * Whether the user can invite in the active space
     */
    canInviteInSpace: boolean;
    /**
     * Whether the user can access space settings
     */
    canAccessSpaceSettings: boolean;
    /**
     * Whether sections are enabled in the room list.
     */
    areSectionsEnabled: boolean;
    /**
     * If "collapse", an icon to collapse all sections is shown.
     * If "expand", an icon to expand all sections is shown.
     * If undefined, no  icon are shown.
     */
    collapseSections?: CollapseSectionsOption;
    /**
     *  Whether to display the section release announcement
     */
    displaySectionReleaseAnnouncement: boolean;
    /**
     * Haven: whether the spaces bar is hidden (Haven.showSpacesBar off). When true, the title acts
     * as a space-switcher button (see SpaceSwitcherMenu) rather than being static text - the spaces
     * bar itself is the only other way to switch spaces, so this becomes the sole way to do so.
     */
    showSpaceSwitcher: boolean;
    /**
     * Haven: the list of spaces to show in the switcher menu. Only meaningful (and non-empty) when
     * showSpaceSwitcher is true.
     */
    spaceSwitcherItems: SpaceSwitcherItem[];
}

/**
 * Haven: a single entry in the space-switcher menu (see RoomListHeaderViewSnapshot.showSpaceSwitcher).
 */
export interface SpaceSwitcherItem {
    /** A MetaSpace key, or a real space's room id. */
    id: string;
    /** Display name. */
    name: string;
    /** Whether this is the currently active space. */
    isActive: boolean;
    /**
     * Unread/notification indicator for this space, mirroring the badge the spaces bar itself
     * shows for it. Undefined (or all-false) shows nothing - same convention as NotificationDecoration
     * itself, which already no-ops in that case.
     */
    notification?: NotificationDecorationData;
}

export interface RoomListHeaderViewActions {
    /**
     * Create a chat room
     */
    createChatRoom: (e: Event) => void;
    /**
     * Create a room
     */
    createRoom: (e: Event) => void;
    /**
     * Create a video room
     */
    createVideoRoom: () => void;
    /**
     * Open the active space home
     */
    openSpaceHome: () => void;
    /**
     * Display the space invite dialog
     */
    inviteInSpace: () => void;
    /**
     * Open the space preferences
     */
    openSpacePreferences: () => void;
    /**
     * Open the space settings
     */
    openSpaceSettings: () => void;
    /**
     * Create a new section in the room list.
     */
    createSection: () => void;
    /**
     * Collapse or expand all sections in the room list depending on the current state.
     */
    collapseOrExpandSections: () => void;
    /**
     * Close the section release announcement
     */
    closeSectionReleaseAnnouncement: () => void;
    /**
     * Haven: switch the active space (see RoomListHeaderViewSnapshot.showSpaceSwitcher).
     */
    switchToSpace: (id: string) => void;
}

/**
 * The view model for the room list header component.
 */
export type RoomListHeaderViewModel = ViewModel<RoomListHeaderViewSnapshot, RoomListHeaderViewActions>;

interface RoomListHeaderViewProps {
    /**
     * The view model for the room list header component.
     */
    vm: RoomListHeaderViewModel;
    /**
     * Haven: renders the icon/avatar for a given space id in the switcher menu (see
     * RoomListHeaderViewSnapshot.showSpaceSwitcher) - this package has no direct access to Matrix
     * rooms/avatars, so the app supplies this. Only required when the switcher can actually be
     * shown; harmless to omit otherwise (the title just renders as plain text in that case too).
     */
    renderSpaceIcon?: (spaceId: string) => ReactElement;
}

/**
 * The header view for the room list
 * The space name is displayed and a compose menu is shown if the user can create rooms
 *
 * @example
 * ```tsx
 * <RoomListHeaderView vm={roomListHeaderViewModel} />
 * ```
 */
export function RoomListHeaderView({ vm, renderSpaceIcon }: Readonly<RoomListHeaderViewProps>): JSX.Element {
    const { translate: _t } = useI18n();
    const {
        title,
        displaySpaceMenu,
        collapseSections,
        areSectionsEnabled,
        canCreateRoom,
        canCreateVideoRoom,
        showSpaceSwitcher,
    } = useViewModel(vm);
    const canOnlyStartChat = !areSectionsEnabled && !canCreateRoom && !canCreateVideoRoom;

    return (
        <Flex
            as="header"
            className={styles.header}
            aria-label={_t("room|context_menu|title")}
            align="end"
            data-testid="room-list-header"
        >
            <Flex className={styles.container} justify="space-between" align="center" gap="var(--cpd-space-3x)">
                <Flex className={styles.title} align="center" gap="var(--cpd-space-1x)">
                    {showSpaceSwitcher && renderSpaceIcon ? (
                        <SpaceSwitcherMenu vm={vm} title={title} renderSpaceIcon={renderSpaceIcon} />
                    ) : (
                        <H1 size="sm" title={title}>
                            {title}
                        </H1>
                    )}
                </Flex>
                <Flex align="center" gap="var(--cpd-space-2x)">
                    {/* Haven: moved here from the title row (see SpaceMenuView's own doc) so it
                        sits alongside the other icon-only actions instead of as a chevron next to
                        the space name. */}
                    {displaySpaceMenu && <SpaceMenuView vm={vm} />}
                    {areSectionsEnabled && collapseSections && (
                        <IconButton
                            size="28px"
                            style={{ padding: "4px" }}
                            onClick={() => vm.collapseOrExpandSections()}
                            tooltip={
                                collapseSections === "collapse"
                                    ? _t("room_list|collapse_all_sections")
                                    : _t("room_list|expand_all_sections")
                            }
                        >
                            {collapseSections === "collapse" ? (
                                <CollapseAllIcon color="var(--cpd-color-icon-secondary)" aria-hidden />
                            ) : (
                                <ExpandAllIcon color="var(--cpd-color-icon-secondary)" aria-hidden />
                            )}
                        </IconButton>
                    )}
                    {canOnlyStartChat ? (
                        <IconButton
                            size="28px"
                            style={{ padding: "4px" }} // Work around miscalculated padding on 28px button: https://github.com/element-hq/compound/issues/409
                            onClick={(e) => vm.createChatRoom(e.nativeEvent)}
                            tooltip={_t("action|start_chat")}
                        >
                            <ChatIcon color="var(--cpd-color-icon-secondary)" aria-hidden />
                        </IconButton>
                    ) : (
                        <ComposeMenuView vm={vm} />
                    )}
                </Flex>
            </Flex>
        </Flex>
    );
}

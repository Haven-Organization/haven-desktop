/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX, useState } from "react";
import { IconButton, Menu, MenuItem } from "@vector-im/compound-web";
import OverflowHorizontalIcon from "@vector-im/compound-design-tokens/assets/web/icons/overflow-horizontal";
import HomeIcon from "@vector-im/compound-design-tokens/assets/web/icons/home";
import SettingsIcon from "@vector-im/compound-design-tokens/assets/web/icons/settings";
import PreferencesIcon from "@vector-im/compound-design-tokens/assets/web/icons/preferences";
import UserAddIcon from "@vector-im/compound-design-tokens/assets/web/icons/user-add";

import { useViewModel } from "../../../core/viewmodel";
import { useI18n } from "../../../core/i18n/i18nContext";
import { type RoomListHeaderViewModel } from "../RoomListHeaderView";

interface SpaceMenuViewProps {
    /**
     * The view model for the room list header
     */
    vm: RoomListHeaderViewModel;
}

/**
 * A menu component that provides space-specific actions.
 * Displays a dropdown menu with options to navigate to space home, invite users,
 * access preferences, and manage space settings.
 *
 * @example
 * ```tsx
 * <SpaceMenuView vm={roomListHeaderViewModel} />
 * ```
 */
export function SpaceMenuView({ vm }: SpaceMenuViewProps): JSX.Element {
    const { translate: _t } = useI18n();
    const { canInviteInSpace, canAccessSpaceSettings, title } = useViewModel(vm);
    const [open, setOpen] = useState(false);

    return (
        <Menu
            open={open}
            onOpenChange={setOpen}
            showTitle={false}
            title={title}
            align="start"
            trigger={
                // Haven: matches the collapse/expand-all and compose "+" buttons it now sits
                // alongside in the header's right-hand action row (see RoomListHeaderView) - same
                // 28px button with a 20px icon, same tooltip convention, rather than the smaller
                // 24px/20px chevron-in-title-row trigger this used to be.
                <IconButton
                    aria-label={_t("room_list|open_space_menu")}
                    tooltip={_t("room_list|open_space_menu")}
                    size="28px"
                    style={{ padding: "4px" }}
                >
                    <OverflowHorizontalIcon color="var(--cpd-color-icon-secondary)" aria-hidden />
                </IconButton>
            }
        >
            <MenuItem Icon={HomeIcon} label={_t("room_list|space_menu|home")} onSelect={vm.openSpaceHome} hideChevron />
            {canInviteInSpace && (
                <MenuItem Icon={UserAddIcon} label={_t("action|invite")} onSelect={vm.inviteInSpace} hideChevron />
            )}
            <MenuItem
                Icon={PreferencesIcon}
                label={_t("common|preferences")}
                onSelect={vm.openSpacePreferences}
                hideChevron
            />
            {canAccessSpaceSettings && (
                <MenuItem
                    Icon={SettingsIcon}
                    label={_t("room_list|space_menu|space_settings")}
                    onSelect={vm.openSpaceSettings}
                    hideChevron
                />
            )}
        </Menu>
    );
}

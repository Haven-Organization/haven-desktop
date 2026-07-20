/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX, type ReactElement, useState } from "react";
import { Menu, MenuItem, H1 } from "@vector-im/compound-web";
import ChevronDownIcon from "@vector-im/compound-design-tokens/assets/web/icons/chevron-down";

import { useViewModel } from "../../../core/viewmodel";
import { useI18n } from "../../../core/i18n/i18nContext";
import { type RoomListHeaderViewModel } from "../RoomListHeaderView";
import { NotificationDecoration } from "../../VirtualizedRoomListView/RoomListItemWrapper/RoomListItemView";
import styles from "./SpaceSwitcherMenu.module.css";

interface SpaceSwitcherMenuProps {
    /** The view model for the room list header */
    vm: RoomListHeaderViewModel;
    /** The currently active space's name - shown as the trigger's own label */
    title: string;
    /** Renders the icon/avatar for a given space id - the app supplies this since this package has
     * no direct access to Matrix rooms/avatars (see RoomListHeaderView's own doc). */
    renderSpaceIcon: (spaceId: string) => ReactElement;
}

/**
 * Haven: replaces the plain, static room-list title with a clickable button that opens a menu
 * listing every space (mirroring the spaces bar's own contents) - the way to navigate between
 * spaces when Haven.showSpacesBar is off and the spaces bar itself isn't shown at all. Only ever
 * rendered by RoomListHeaderView in that state; otherwise the title stays plain text, since the
 * spaces bar itself already covers navigation.
 *
 * @example
 * ```tsx
 * <SpaceSwitcherMenu vm={roomListHeaderViewModel} title="Home" renderSpaceIcon={renderSpaceIcon} />
 * ```
 */
export function SpaceSwitcherMenu({ vm, title, renderSpaceIcon }: SpaceSwitcherMenuProps): JSX.Element {
    const { translate: _t } = useI18n();
    const { spaceSwitcherItems } = useViewModel(vm);
    const [open, setOpen] = useState(false);

    return (
        <Menu
            open={open}
            onOpenChange={setOpen}
            showTitle={false}
            title={_t("room_list|switch_space")}
            align="start"
            trigger={
                <button type="button" className={styles.trigger} aria-label={_t("room_list|switch_space")}>
                    <H1 size="sm" title={title}>
                        {title}
                    </H1>
                    <ChevronDownIcon className={styles.chevron} width="20px" height="20px" aria-hidden />
                </button>
            }
        >
            {/* Haven: capped and scrollable so a large number of spaces doesn't push the menu off
                the bottom of the screen (or grow it past a sane size) - see the module CSS. */}
            <div className={styles.list}>
                {spaceSwitcherItems.map((item) => (
                    <MenuItem
                        key={item.id}
                        Icon={renderSpaceIcon(item.id)}
                        label={item.name}
                        // Haven: MenuItem has no built-in "currently selected" indicator (unlike
                        // RadioMenuItem, which would be the obvious fit here but doesn't accept an
                        // Icon at all) - bolding the active space's own label is a light-touch way to
                        // still show which one you're in, matching the existing convention for
                        // unread/active room names elsewhere in the room list.
                        labelProps={{ weight: item.isActive ? "semibold" : "regular" }}
                        onSelect={() => vm.switchToSpace(item.id)}
                        hideChevron
                    >
                        {/* Mirrors the spaces bar's own unread/notification badge for this space -
                            renders nothing when there's nothing to show (see NotificationDecoration's
                            own early-return). aria-hidden since the room name alone is the item's
                            accessible name (matches how room list items wrap this same component -
                            see RoomListItemContent.tsx) - without it, e.g. a count of "3" reads as
                            part of the menu item's own name instead of being purely decorative. */}
                        {item.notification && (
                            <div aria-hidden={true}>
                                <NotificationDecoration {...item.notification} />
                            </div>
                        )}
                    </MenuItem>
                ))}
            </div>
        </Menu>
    );
}

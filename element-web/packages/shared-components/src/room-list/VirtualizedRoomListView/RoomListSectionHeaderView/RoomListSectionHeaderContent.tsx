/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { memo, type JSX, useState } from "react";
import ChevronRightIcon from "@vector-im/compound-design-tokens/assets/web/icons/chevron-right";
import classNames from "classnames";
import { CheckboxMenuItem, IconButton, Menu, MenuItem, MenuTitle, RadioMenuItem, Separator } from "@vector-im/compound-web";
import { OverflowHorizontalIcon, EditIcon, DeleteIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import { useViewModel } from "../../../core/viewmodel";
import { _t } from "../../../core/i18n/i18n";
import { Flex } from "../../../core/utils/Flex";
import { type RoomListSectionHeaderViewModel } from "./RoomListSectionHeaderView";
import styles from "./RoomListSectionHeaderView.module.css";
import { NotificationDecoration } from "../RoomListItemWrapper/RoomListItemView";

/**
 * Props for {@link RoomListSectionHeaderContent}.
 */
export interface RoomListSectionHeaderContentProps {
    /** The section header view model */
    vm: RoomListSectionHeaderViewModel;
    /** Whether the section header is being dragged — hides the interactive menu when true */
    isDragging?: boolean;
}

/**
 * The inner content of a section header: chevron, title, and menu (or static menu icon when dragging).
 * Used both inside the full {@link RoomListSectionHeaderView} and inside the drag overlay.
 */
export const RoomListSectionHeaderContent = memo(function RoomListSectionHeaderContent({
    vm,
    isDragging = false,
}: RoomListSectionHeaderContentProps): JSX.Element {
    const { title, displaySectionMenu, notification, isExpanded } = useViewModel(vm);
    return (
        <Flex
            className={classNames(styles.container, {
                [styles.dragging]: isDragging,
            })}
            align="center"
            justify="space-between"
            gap="var(--cpd-space-2x)"
        >
            <Flex align="center" gap="var(--cpd-space-0-5x)">
                <ChevronRightIcon
                    className={styles.chevron}
                    width="24px"
                    height="24px"
                    fill="var(--cpd-color-icon-secondary)"
                />
                <span className={styles.title}>{title}</span>
            </Flex>
            {!isExpanded && notification && (
                <div className={styles.notificationDecoration} aria-hidden={true}>
                    <NotificationDecoration {...notification} />
                </div>
            )}
            {displaySectionMenu && !isDragging && <MenuComponent vm={vm} />}
        </Flex>
    );
});

interface MenuComponentProps {
    vm: RoomListSectionHeaderViewModel;
}

function MenuComponent({ vm }: MenuComponentProps): JSX.Element {
    const [open, setOpen] = useState(false);

    return (
        <Menu
            open={open}
            onOpenChange={setOpen}
            title={_t("room_list|section_header|more_options")}
            showTitle={false}
            align="start"
            trigger={
                <IconButton
                    className={styles.menu}
                    tooltip={_t("room_list|section_header|more_options")}
                    aria-label={_t("room_list|section_header|more_options")}
                    size="24px"
                    style={{ padding: "2px" }}
                    color="var(--cpd-color-icon-primary)"
                >
                    <OverflowHorizontalIcon fill="var(--cpd-color-icon-primary)" />
                </IconButton>
            }
        >
            <SectionHeaderMoreOptionContent vm={vm} />
        </Menu>
    );
}

export interface SectionHeaderMoreOptionContentProps {
    /** The section header view model */
    vm: RoomListSectionHeaderViewModel;
}

/**
 * The menu items shared between the section header's hover-revealed "..." button
 * ({@link MenuComponent}) and its right-click context menu ({@link RoomListSectionHeaderContextMenu}).
 */
export function SectionHeaderMoreOptionContent({ vm }: SectionHeaderMoreOptionContentProps): JSX.Element {
    const { canEditOrRemoveSection, activeSortOption, isMessagePreviewEnabled } = useViewModel(vm);

    return (
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <div
            // We don't want keyboard navigation events to bubble up to the ListView changing
            // the focused item. Menu content renders via a portal, so it's detached from this
            // button in the DOM, but React's synthetic event delegation still bubbles clicks
            // through the JSX tree - without stopping it here, choosing any item (Sort,
            // Appearance, Edit/Remove) also fires the section header button's own onClick,
            // toggling expand/collapse as an unwanted side effect. RadioMenuItem/CheckboxMenuItem
            // don't accept their own onClick prop (only MenuItem does), so this is caught once
            // at the wrapper instead of per item.
            onKeyDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
        >
            <MenuTitle title={_t("room_list|sort")} className={styles.menuTitle} />
            <RadioMenuItem
                label={_t("room_list|sort_type|activity")}
                checked={activeSortOption === "recent"}
                onSelect={() => vm.sort("recent")}
            />
            <RadioMenuItem
                label={_t("room_list|sort_type|unread_first")}
                checked={activeSortOption === "unread-first"}
                onSelect={() => vm.sort("unread-first")}
            />
            <RadioMenuItem
                label={_t("room_list|sort_type|atoz")}
                checked={activeSortOption === "alphabetical"}
                onSelect={() => vm.sort("alphabetical")}
            />
            <MenuTitle title={_t("room_list|appearance")} />
            <CheckboxMenuItem
                label={_t("room_list|show_message_previews")}
                checked={isMessagePreviewEnabled}
                onSelect={vm.toggleMessagePreview}
            />
            {canEditOrRemoveSection && (
                <>
                    <Separator />
                    <MenuItem
                        hideChevron={true}
                        Icon={EditIcon}
                        label={_t("room_list|section_header|edit_section")}
                        onSelect={() => vm.editSection()}
                    />
                    <MenuItem
                        hideChevron={true}
                        Icon={DeleteIcon}
                        label={_t("room_list|section_header|remove_section")}
                        onSelect={() => vm.removeSection()}
                    />
                </>
            )}
        </div>
    );
}

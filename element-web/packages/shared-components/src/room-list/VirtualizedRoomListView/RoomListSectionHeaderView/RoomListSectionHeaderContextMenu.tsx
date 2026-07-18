/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX, type PropsWithChildren } from "react";
import { ContextMenu } from "@vector-im/compound-web";

import { _t } from "../../../core/i18n/i18n";
import { SectionHeaderMoreOptionContent } from "./RoomListSectionHeaderContent";
import { type RoomListSectionHeaderViewModel } from "./RoomListSectionHeaderView";

/**
 * Props for RoomListSectionHeaderContextMenu component
 */
export interface RoomListSectionHeaderContextMenuProps {
    /** The section header view model */
    vm: RoomListSectionHeaderViewModel;
}

/**
 * The context menu for room list section headers.
 * Wraps the trigger element with a right-click context menu showing the same Sort/Appearance
 * (and, for custom sections, Edit/Remove) options as the hover-revealed "..." button.
 */
export const RoomListSectionHeaderContextMenu: React.FC<PropsWithChildren<RoomListSectionHeaderContextMenuProps>> = ({
    vm,
    children,
}): JSX.Element => {
    return (
        <ContextMenu
            title={_t("room_list|section_header|more_options")}
            showTitle={false}
            hasAccessibleAlternative={true}
            trigger={children}
        >
            <SectionHeaderMoreOptionContent vm={vm} />
        </ContextMenu>
    );
};

/*
 * Haven apps framework — AppsButton
 *
 * Launcher button that opens AppsPickerModal (a 3x3 grid of every registered app). Two variants
 * sharing the same popup-opening logic:
 *  - "spacebar": rendered inside the space bar above SpacePanelAppButtons' pinned/open app
 *    buttons, styled to match those buttons exactly (same haven_SpaceAppItem/Button classes).
 *  - "compact": rendered next to the relocated UserMenu (see SpacePanel's userMenuPortalTarget)
 *    when the spaces bar is hidden — a stock compound IconButton instead, since it sits in a
 *    horizontal row rather than the vertical space-button column.
 */

import React, { type JSX } from "react";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import { IconButton, Tooltip } from "@vector-im/compound-web";

import { useContextMenu, toRightOf } from "../../../../element-web/apps/web/src/components/structures/ContextMenu";
import { AppsGridIcon } from "../icons/AppsGridIcon";
import { AppsPickerModal } from "./AppsPickerModal";
import { getEnabledApps } from "../registry";

interface Props {
    client: MatrixClient;
    variant: "spacebar" | "compact";
    isPanelCollapsed?: boolean;
}

export function AppsButton({ client, variant, isPanelCollapsed }: Props): JSX.Element | null {
    // Nothing to launch - a picker with nothing in it isn't a useful button, it's just a dead click
    // target. SpacePanel.tsx's own divider right after this button (spacebar variant) is
    // conditioned on this same emptiness check, so the two disappear together.
    const [menuDisplayed, handle, openMenu, closeMenu] = useContextMenu<HTMLButtonElement>();
    if (getEnabledApps().length === 0) return null;

    const popup = menuDisplayed && handle.current && (
        <AppsPickerModal {...toRightOf(handle.current.getBoundingClientRect())} client={client} onFinished={closeMenu} />
    );

    if (variant === "compact") {
        return (
            <div className="haven_AppsButton_compactWrapper">
                <Tooltip label="Apps" placement="bottom">
                    {/* 32px to match the relocated UserMenu avatar, RoomSearch's collapsed icon, and
                        mx_LeftPanel_exploreButton — all 32px in this row/stack (see
                        haven_UserMenu_relocated's [data-type="round"] override in apps-framework.scss).
                        This used to be 38px to match the "spacebar" variant's own icon box, but that
                        variant isn't visible at the same time as this one (spaces bar is hidden
                        whenever this compact variant renders), so there was nothing to actually match
                        against — it just made this button visibly bigger than its neighbors here. */}
                    <IconButton
                        ref={handle}
                        aria-label="Apps"
                        onClick={openMenu}
                        size="32px"
                        className={`haven_AppsButton_compactIcon${menuDisplayed ? " haven_AppsButton_compactIcon--active" : ""}`}
                    >
                        <AppsGridIcon />
                    </IconButton>
                </Tooltip>
                {popup}
            </div>
        );
    }

    return (
        <li
            className={`haven_SpaceAppItem${isPanelCollapsed ? " haven_SpaceAppItem--collapsed" : ""}`}
            role="treeitem"
            aria-selected={false}
            title={isPanelCollapsed ? "Apps" : undefined}
        >
            <button
                ref={handle}
                // haven_SpaceAppButton--launcherActive (not the shared --active used for a
                // selected/open app) - deliberately its own, narrower highlight: the same icon
                // background tint, but without --active's own accent bar. The picker being open
                // isn't "this is the currently selected app" (whatever app was already open/pinned
                // stays the selected one, still showing its own accent bar the whole time) - just
                // this button's own momentary pressed/toggled look.
                className={`haven_SpaceAppButton${menuDisplayed ? " haven_SpaceAppButton--launcherActive" : ""}`}
                onClick={openMenu}
                aria-label="Apps"
            >
                <div className="haven_SpaceAppButton_icon" aria-hidden="true">
                    <AppsGridIcon />
                </div>
                {!isPanelCollapsed && <span className="haven_SpaceAppButton_label">Apps</span>}
            </button>
            {popup}
        </li>
    );
}

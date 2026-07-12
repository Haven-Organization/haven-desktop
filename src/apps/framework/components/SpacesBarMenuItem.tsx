/*
 * Haven apps framework — SpacesBarMenuItem
 *
 * Renders inside the UserMenu (top-left menu), above "All settings" — a checkbox toggling whether
 * the spaces bar (space panel) is shown at all. On by default.
 *
 * Uses MenuItem directly (not compound-web's CheckboxMenuItem) so the checkbox can be wrapped in a
 * 24x24 box matching every other menu item's icon size — CheckboxInput's own native size is 20px,
 * and MenuItem's per-item CSS grid sizes its icon column to its own content (not shared across
 * sibling rows), so a bare 20px checkbox left its whole row's icon column narrower than the other
 * rows', visibly shifting "Spaces Bar" left of where every other item's label starts.
 */

import React, { type JSX } from "react";
import { MenuItem, CheckboxInput } from "@vector-im/compound-web";

import SettingsStore from "../../../../element-web/apps/web/src/settings/SettingsStore";
import { SettingLevel } from "../../../../element-web/apps/web/src/settings/SettingLevel";
import { useSettingValue } from "../../../../element-web/apps/web/src/hooks/useSettings";

export function SpacesBarMenuItem(): JSX.Element {
    const showSpacesBar = useSettingValue("Haven.showSpacesBar");

    const onSelect = (e: Event): void => {
        e.preventDefault(); // keep the menu open so the toggled state is visible
        void SettingsStore.setValue("Haven.showSpacesBar", null, SettingLevel.ACCOUNT, !showSpacesBar);
    };

    return (
        <MenuItem
            as="button"
            role="menuitemcheckbox"
            aria-checked={showSpacesBar}
            label="Spaces Bar"
            hideChevron
            onSelect={onSelect}
            Icon={
                <div className="haven_SpacesBarMenuItem_iconSlot">
                    <CheckboxInput aria-hidden tabIndex={-1} checked={showSpacesBar} onChange={() => {}} />
                </div>
            }
        />
    );
}

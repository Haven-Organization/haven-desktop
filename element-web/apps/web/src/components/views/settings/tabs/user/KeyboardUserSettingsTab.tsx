/*
Copyright 2024 New Vector Ltd.
Copyright 2021, 2022 Šimon Brandner <simon.bra.ag@gmail.com>
Copyright 2020 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { useCallback, useState } from "react";

import {
    type ICategory,
    CATEGORIES,
    CategoryName,
    type KeyBindingAction,
} from "../../../../../accessibility/KeyboardShortcuts";
import { _t } from "../../../../../languageHandler";
import {
    getKeyboardShortcutDisplayName,
    getKeyboardShortcutValue,
    isShortcutCustomizable,
} from "../../../../../accessibility/KeyboardShortcutUtils";
import { KeyboardShortcut } from "../../KeyboardShortcut";
import SettingsTab from "../SettingsTab";
import { SettingsSection } from "../../shared/SettingsSection";
import { SettingsSubsection } from "../../shared/SettingsSubsection";
import { showLabsFlags } from "./LabsUserSettingsTab";
import AccessibleButton from "../../../elements/AccessibleButton";
import Modal from "../../../../../Modal";
import QuestionDialog from "../../../dialogs/QuestionDialog";
// haven apps-framework patch
import { RecordKeyboardShortcutDialog } from "../../../../../../../../../src/apps/framework/components/RecordKeyboardShortcutDialog";
import { setCustomShortcut, resetAllCustomShortcuts } from "../../../../../../../../../src/apps/framework/customKeyboardShortcuts";

interface IKeyboardShortcutRowProps {
    name: KeyBindingAction;
    /** Haven: called after this row's own shortcut is actually changed - SettingsStore mutations
     *  don't push any re-render on their own, so the tab at the bottom of this file needs an
     *  explicit nudge (bumping its own state) to get every row (this one, and every other one -
     *  see its own onResetToDefault, which affects all of them at once) to re-read
     *  getKeyboardShortcutValue and reflect the change. */
    onShortcutChanged: () => void;
}

// Filter out the labs section if labs aren't enabled.
const visibleCategories = (Object.entries(CATEGORIES) as [CategoryName, ICategory][]).filter(
    ([categoryName]) => categoryName !== CategoryName.LABS || showLabsFlags(),
);

const KeyboardShortcutRow: React.FC<IKeyboardShortcutRowProps> = ({ name, onShortcutChanged }) => {
    const displayName = getKeyboardShortcutDisplayName(name);
    const value = getKeyboardShortcutValue(name);
    if (!displayName || !value) return null;

    // Haven: only shortcuts whose default already uses a modifier and isn't Enter/Escape/Tab can
    // be customized at all - see KeyboardShortcutUtils.ts's own isShortcutCustomizable doc for the
    // full reasoning. Every other row renders exactly as it always has, not even a hover style.
    if (!isShortcutCustomizable(name)) {
        return (
            <li className="mx_KeyboardShortcut_shortcutRow">
                {displayName}
                <KeyboardShortcut value={value} />
            </li>
        );
    }

    const onClick = async (): Promise<void> => {
        const { finished } = Modal.createDialog(RecordKeyboardShortcutDialog, {
            actionDisplayName: displayName,
            currentValue: value,
        });
        const [combo] = await finished;
        if (combo) {
            await setCustomShortcut(name, combo);
            onShortcutChanged();
        }
    };

    return (
        <li className="mx_KeyboardShortcut_shortcutRow">
            {displayName}
            <AccessibleButton
                className="haven_KeyboardShortcut_editable"
                onClick={onClick}
                title="Click to change this shortcut"
            >
                <KeyboardShortcut value={value} />
            </AccessibleButton>
        </li>
    );
};

interface IKeyboardShortcutSectionProps {
    categoryName: CategoryName;
    category: ICategory;
    onShortcutChanged: () => void;
}

const KeyboardShortcutSection: React.FC<IKeyboardShortcutSectionProps> = ({
    categoryName,
    category,
    onShortcutChanged,
}) => {
    if (!category.categoryLabel) return null;

    return (
        <SettingsSubsection heading={_t(category.categoryLabel)} key={categoryName}>
            <ul className="mx_KeyboardShortcut_shortcutList">
                {category.settingNames.map((shortcutName) => {
                    return (
                        <KeyboardShortcutRow
                            key={shortcutName}
                            name={shortcutName}
                            onShortcutChanged={onShortcutChanged}
                        />
                    );
                })}
            </ul>
        </SettingsSubsection>
    );
};

const KeyboardUserSettingsTab: React.FC = () => {
    // Haven: bumping this is the only way to get the whole tree below to re-render and pick up a
    // shortcut change - see IKeyboardShortcutRowProps's own onShortcutChanged doc. The value itself
    // is never read anywhere, only ever set - its sole job is to be a different value each time.
    const [, setRefreshCounter] = useState(0);
    const refresh = useCallback(() => setRefreshCounter((c) => c + 1), []);

    const onResetToDefault = useCallback(async (): Promise<void> => {
        const { finished } = Modal.createDialog(QuestionDialog, {
            title: "Reset keyboard shortcuts",
            description:
                "This will remove all of your custom keyboard shortcuts and restore the defaults. This can't be undone.",
            button: "Confirm",
            danger: true,
            quitOnly: true,
        });
        const [confirmed] = await finished;
        if (confirmed) {
            await resetAllCustomShortcuts();
            refresh();
        }
    }, [refresh]);

    return (
        <SettingsTab>
            <SettingsSection>
                {visibleCategories.map(([categoryName, category]) => {
                    return (
                        <KeyboardShortcutSection
                            key={categoryName}
                            categoryName={categoryName}
                            category={category}
                            onShortcutChanged={refresh}
                        />
                    );
                })}
                {/* Haven: only ever clears CUSTOM overrides (see resetAllCustomShortcuts) - never
                    touches the shortcuts that were never customizable to begin with, so this is
                    exactly "undo everything above", not a blanket wipe of anything else. */}
                <AccessibleButton kind="danger" onClick={onResetToDefault}>
                    Reset to Default
                </AccessibleButton>
            </SettingsSection>
        </SettingsTab>
    );
};

export default KeyboardUserSettingsTab;

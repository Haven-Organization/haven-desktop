/*
Copyright 2026 Haven

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useCallback } from "react";

import { _t } from "../../../languageHandler";
import SettingsStore from "../../../settings/SettingsStore";
import { SettingLevel } from "../../../settings/SettingLevel";
import { useSettingValue } from "../../../hooks/useSettings";
import { getHostBlockquoteStyle } from "../../../../../../../src/apps/framework/config";
import { EmojiPreferenceDropdown } from "./EmojiPreferenceSwitchers";

/*
 * Haven: Settings > Preferences > Composer. How a line starting with ">" renders in what the user
 * sends: a stock quote or greentext. Shows the host's style ("haven.blockquote_style") until the
 * user picks one, which then applies on every device.
 */
export function BlockquoteStyleSwitcher(): JSX.Element {
    const own = useSettingValue("Haven.blockquoteStyle");
    const current = own ?? getHostBlockquoteStyle();
    const onChange = useCallback((style: string): void => {
        void SettingsStore.setValue(
            "Haven.blockquoteStyle",
            null,
            SettingLevel.ACCOUNT,
            style === "greentext" ? "greentext" : "stock",
        );
    }, []);

    return (
        <EmojiPreferenceDropdown
            label={_t("settings|preferences|blockquote_style")}
            description={_t("settings|preferences|blockquote_style_description")}
            value={current}
            onChange={onChange}
            menuWidth={200}
            previewIsLabel
            options={[
                {
                    value: "stock",
                    label: _t("settings|preferences|blockquote_style_stock"),
                    preview: (
                        <span className="mx_BlockquoteStyleSwitcher_quote">
                            {_t("settings|preferences|blockquote_style_stock")}
                        </span>
                    ),
                },
                {
                    value: "greentext",
                    label: _t("settings|preferences|blockquote_style_greentext"),
                    preview: (
                        <span className="mx_BlockquoteStyleSwitcher_greentext">
                            &gt;{_t("settings|preferences|blockquote_style_greentext")}
                        </span>
                    ),
                },
            ]}
        />
    );
}

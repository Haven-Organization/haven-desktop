/*
Copyright 2026 Haven

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, type ReactNode, useCallback, useId } from "react";
import { EMOJI_SKIN_TONES, type EmojiSkinTone, skinToneModifier } from "@element-hq/web-shared-components";

import { _t } from "../../../languageHandler";
import SettingsStore from "../../../settings/SettingsStore";
import { SettingLevel } from "../../../settings/SettingLevel";
import { useSettingValue } from "../../../hooks/useSettings";
import { GunEmojiStyle } from "../../../settings/enums/GunEmojiStyle";
import { FontWatcher } from "../../../settings/watchers/FontWatcher";
import Dropdown, { type DropdownProps } from "../elements/Dropdown";

/*
 * Haven: the two "which emoji variant do I see" preferences on the Emoji & Stickers tab - the gun
 * emoji's artwork and the skin tone used by the picker/autocomplete. Each is a dropdown laid out like
 * the toggles above it (title and description on the left, control on the right), so they take up
 * about as much room as one of those rather than a full tile grid. Every option carries a small
 * preview of what it looks like.
 */

const GUN_STYLES: { style: GunEmojiStyle; label: () => string }[] = [
    { style: GunEmojiStyle.Revolver, label: () => _t("settings|emoji_stickers|gun_emoji_style_revolver") },
    { style: GunEmojiStyle.Handgun, label: () => _t("settings|emoji_stickers|gun_emoji_style_handgun") },
    { style: GunEmojiStyle.WaterPistol, label: () => _t("settings|emoji_stickers|gun_emoji_style_water_pistol") },
];

const SKIN_TONE_LABELS: Record<EmojiSkinTone, () => string> = {
    "none": () => _t("settings|emoji_stickers|emoji_skin_tone_none"),
    "light": () => _t("settings|emoji_stickers|emoji_skin_tone_light"),
    "medium-light": () => _t("settings|emoji_stickers|emoji_skin_tone_medium_light"),
    "medium": () => _t("settings|emoji_stickers|emoji_skin_tone_medium"),
    "medium-dark": () => _t("settings|emoji_stickers|emoji_skin_tone_medium_dark"),
    "dark": () => _t("settings|emoji_stickers|emoji_skin_tone_dark"),
};

// The emoji every skin tone option previews itself on.
const SKIN_TONE_PREVIEW_BASE = "\u{1F44D}";

interface EmojiPreferenceOption {
    value: string;
    label: string;
    preview: ReactNode;
}

interface EmojiPreferenceDropdownProps {
    label: string;
    description: string;
    value: string;
    options: EmojiPreferenceOption[];
    onChange(value: string): void;
}

function EmojiPreferenceDropdown({
    label,
    description,
    value,
    options,
    onChange,
}: EmojiPreferenceDropdownProps): JSX.Element {
    const id = useId();
    const children = options.map((option) => (
        <div key={option.value} className="mx_EmojiPreferenceDropdown_option">
            <span className="mx_EmojiPreferenceDropdown_preview" aria-hidden="true">
                {option.preview}
            </span>
            {option.label}
        </div>
    )) as DropdownProps["children"];

    return (
        <div className="mx_EmojiPreferenceDropdown">
            <div className="mx_EmojiPreferenceDropdown_text">
                <label className="mx_EmojiPreferenceDropdown_label" htmlFor={id}>
                    {label}
                </label>
                <div className="mx_EmojiPreferenceDropdown_description">{description}</div>
            </div>
            <Dropdown id={id} label={label} value={value} menuWidth={200} onOptionChange={onChange}>
                {children}
            </Dropdown>
        </div>
    );
}

/** Which gun the 🔫 emoji is drawn as. Device-level, like "Use bundled emoji font" itself. */
export function GunEmojiStyleSwitcher(): JSX.Element {
    const current = useSettingValue("Haven.gunEmojiStyle");
    const onChange = useCallback((style: string): void => {
        void SettingsStore.setValue("Haven.gunEmojiStyle", null, SettingLevel.DEVICE, style as GunEmojiStyle);
    }, []);

    return (
        <EmojiPreferenceDropdown
            label={_t("settings|emoji_stickers|gun_emoji_style")}
            description={_t("settings|emoji_stickers|gun_emoji_style_description")}
            value={current}
            onChange={onChange}
            options={GUN_STYLES.map(({ style, label }) => ({
                value: style,
                label: label(),
                // Explicit font stack per option, rather than the live --emoji-font-family, so each
                // option shows its own style regardless of which one is currently selected.
                preview: (
                    <span style={{ fontFamily: `${FontWatcher.bundledEmojiFontStack(style)}, sans-serif` }}>
                        {"\u{1F52B}"}
                    </span>
                ),
            }))}
        />
    );
}

/** The skin tone the picker (and emoji autocomplete) applies to emoji that have variants. */
export function EmojiSkinToneSwitcher(): JSX.Element {
    const current = useSettingValue("Haven.emojiSkinTone");
    const onChange = useCallback((tone: string): void => {
        void SettingsStore.setValue("Haven.emojiSkinTone", null, SettingLevel.ACCOUNT, tone as EmojiSkinTone);
    }, []);

    return (
        <EmojiPreferenceDropdown
            label={_t("settings|emoji_stickers|emoji_skin_tone")}
            description={_t("settings|emoji_stickers|emoji_skin_tone_description")}
            value={current}
            onChange={onChange}
            options={EMOJI_SKIN_TONES.map((tone) => ({
                value: tone,
                label: SKIN_TONE_LABELS[tone](),
                preview: SKIN_TONE_PREVIEW_BASE + skinToneModifier(tone),
            }))}
        />
    );
}

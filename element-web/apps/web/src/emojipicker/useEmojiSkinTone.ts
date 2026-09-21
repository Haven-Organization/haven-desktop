/*
 * Haven: the user's emoji skin tone (the account-level `Haven.emojiSkinTone` setting) and a setter
 * for it, shaped as the `skinTone` / `onSkinToneChange` props of the shared EmojiPicker so both
 * picker wrappers can spread it straight through.
 */

import { useCallback } from "react";
import { type EmojiSkinTone } from "@element-hq/web-shared-components";

import { useSettingValue } from "../hooks/useSettings";
import SettingsStore from "../settings/SettingsStore";
import { SettingLevel } from "../settings/SettingLevel";

export function useEmojiSkinTone(): { skinTone: EmojiSkinTone; onSkinToneChange: (tone: EmojiSkinTone) => void } {
    const skinTone = useSettingValue("Haven.emojiSkinTone");
    const onSkinToneChange = useCallback((tone: EmojiSkinTone): void => {
        // Fire and forget, like the settings UI: the setting's own watchers update every picker.
        void SettingsStore.setValue("Haven.emojiSkinTone", null, SettingLevel.ACCOUNT, tone);
    }, []);
    return { skinTone, onSkinToneChange };
}

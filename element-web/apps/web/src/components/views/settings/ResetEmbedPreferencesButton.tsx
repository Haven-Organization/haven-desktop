/*
 * Haven: clears the sites whose links always embed - see RichEmbed.tsx.
 */

import React, { type JSX } from "react";
import { Button } from "@vector-im/compound-web";

import { _t } from "../../../languageHandler";
import { useSettingValue } from "../../../hooks/useSettings";
import SettingsStore from "../../../settings/SettingsStore";
import { SettingLevel } from "../../../settings/SettingLevel";

/** Greyed out while rich embeds are off, to show it belongs to that setting. */
export function ResetEmbedPreferencesButton(): JSX.Element {
    const enabled = useSettingValue("Haven.richEmbeds");
    return (
        <Button
            className="mx_ResetEmbedPreferencesButton"
            kind="secondary"
            size="md"
            disabled={!enabled}
            onClick={() => void SettingsStore.setValue("Haven.alwaysEmbedSites", null, SettingLevel.ACCOUNT, [])}
        >
            {_t("settings|preferences|reset_embed_preferences")}
        </Button>
    );
}

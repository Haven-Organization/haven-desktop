/*
 * Haven - message translation: Settings > Preferences > Translation. Which site to translate with
 * (or off), and which language to translate into (the app's language until the user picks one).
 */

import React, { type JSX, useMemo } from "react";

import Field from "../../../../element-web/apps/web/src/components/views/elements/Field";
import { _t } from "../../../../element-web/apps/web/src/languageHandler";
import SettingsStore from "../../../../element-web/apps/web/src/settings/SettingsStore";
import { SettingLevel } from "../../../../element-web/apps/web/src/settings/SettingLevel";
import { useSettingValue } from "../../../../element-web/apps/web/src/hooks/useSettings";
import { getAppTargetLanguage, languageName, TARGET_LANGUAGES } from "./languages";
import { SERVICE_OFF } from "./services";
import { getAvailableServices, getTranslationService } from "./translationSettings";

/** The target language select's value for "the app's language". */
const APP_LANGUAGE = "";

export function TranslationSettings(): JSX.Element {
    const serviceSetting = useSettingValue("Haven.translationService");
    const targetSetting = useSettingValue("Haven.translationTargetLanguage");
    const services = getAvailableServices();
    const service = getTranslationService(serviceSetting);

    const languages = useMemo(
        () =>
            TARGET_LANGUAGES.map((language) => ({ language, name: languageName(language) })).sort((a, b) =>
                a.name.localeCompare(b.name),
            ),
        [],
    );
    const appLanguage = getAppTargetLanguage() ?? "en";
    const target =
        typeof targetSetting === "string" && TARGET_LANGUAGES.includes(targetSetting) ? targetSetting : APP_LANGUAGE;

    return (
        <>
            <Field
                element="select"
                className="haven_TranslationSettings_select"
                label={_t("settings|preferences|translation_service")}
                value={service?.id ?? SERVICE_OFF}
                onChange={(e) =>
                    void SettingsStore.setValue("Haven.translationService", null, SettingLevel.ACCOUNT, e.target.value)
                }
            >
                {services.map((s) => (
                    <option key={s.id} value={s.id}>
                        {s.name}
                    </option>
                ))}
                <option value={SERVICE_OFF}>{_t("settings|preferences|translation_service_off")}</option>
            </Field>
            <Field
                element="select"
                className="haven_TranslationSettings_select"
                label={_t("settings|preferences|translation_target_language")}
                value={target}
                disabled={!service}
                onChange={(e) =>
                    void SettingsStore.setValue(
                        "Haven.translationTargetLanguage",
                        null,
                        SettingLevel.ACCOUNT,
                        e.target.value === APP_LANGUAGE ? null : e.target.value,
                    )
                }
            >
                <option value={APP_LANGUAGE}>
                    {_t("settings|preferences|translation_target_language_app", {
                        language: languageName(appLanguage),
                    })}
                </option>
                {languages.map(({ language, name }) => (
                    <option key={language} value={language}>
                        {name}
                    </option>
                ))}
            </Field>
        </>
    );
}

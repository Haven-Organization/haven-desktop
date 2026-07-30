/*
 * Haven apps framework — user settings "Apps" tab.
 *
 * Lists every enabled Haven app (see apps/framework/registry.ts), each with a "Settings" button
 * for the ones that have something to configure (HavenApp.SettingsComponent) - clicking it swaps
 * this tab's own content to that app's settings page, the same "list -> click through -> back"
 * shape EmojiStickersUserSettingsTab.tsx already uses for an individual pack (see PackEditor.tsx),
 * restyled here as a row per app instead of a row per pack.
 */

import { type JSX, useState } from "react";

import { _t } from "../../../../../languageHandler";
import SettingsTab from "../SettingsTab";
import { SettingsSection } from "../../shared/SettingsSection";
import { SettingsSubsection } from "../../shared/SettingsSubsection";
import AccessibleButton from "../../../elements/AccessibleButton";
import { getEnabledApps } from "../../../../../../../../../src/apps/framework/registry";

export default function AppsUserSettingsTab(): JSX.Element {
    const apps = getEnabledApps();
    const [openAppId, setOpenAppId] = useState<string | null>(null);

    const openApp = apps.find((app) => app.id === openAppId);
    if (openApp?.SettingsComponent) {
        const AppSettings = openApp.SettingsComponent;
        return (
            <SettingsTab>
                {/* Combined "Apps: <app name>" heading rather than a separate "Apps" heading here
                    plus the app's own "<app name>" heading further down (SocialSettingsTab.tsx
                    deliberately has none of its own, for exactly this reason) - one heading, with
                    the Back button and the app's own first section sitting right below it instead
                    of a second heading's worth of vertical space away. */}
                <SettingsSection heading={`${_t("settings|apps|title")}: ${openApp.name}`}>
                    <div className="mx_AppsUserSettingsTab_backBar">
                        <AccessibleButton kind="primary_outline" onClick={() => setOpenAppId(null)}>
                            {`← ${_t("action|back")}`}
                        </AccessibleButton>
                    </div>
                    <AppSettings />
                </SettingsSection>
            </SettingsTab>
        );
    }

    return (
        <SettingsTab>
            <SettingsSection heading={_t("settings|apps|title")}>
                <SettingsSubsection formWrap>
                    <div className="mx_AppsUserSettingsTab_appList">
                        {apps.map((app) => (
                            <div className="mx_AppsUserSettingsTab_appRow" key={app.id}>
                                <div className="mx_AppsUserSettingsTab_appRowLabel">
                                    {app.image ? (
                                        <img className="mx_AppsUserSettingsTab_avatar" src={app.image} alt="" />
                                    ) : (
                                        <app.Icon className="mx_AppsUserSettingsTab_avatar" />
                                    )}
                                    <span className="mx_AppsUserSettingsTab_appName">{app.name}</span>
                                </div>
                                {app.SettingsComponent && (
                                    <AccessibleButton kind="primary_outline" onClick={() => setOpenAppId(app.id)}>
                                        {_t("common|settings")}
                                    </AccessibleButton>
                                )}
                            </div>
                        ))}
                    </div>
                </SettingsSubsection>
            </SettingsSection>
        </SettingsTab>
    );
}

/*
 * Social Overlay — SocialSettingsTab
 *
 * This app's own page within the user settings dialog's "Apps" tab (see
 * AppsUserSettingsTab.tsx and HavenApp.SettingsComponent) - reached by clicking Social's own
 * "Settings" button there, not a standalone dialog tab of its own. Renders directly inside the
 * parent's own <SettingsSection> (its combined "Apps: Social" heading, right below the Back
 * button) rather than wrapping its own <SettingsTab>/<SettingsSection> - no "Social" heading of
 * its own here, to avoid a second heading repeating what the parent's already says.
 */

import React, { type JSX } from "react";

import { SettingsSubsection } from "../../../../element-web/apps/web/src/components/views/settings/shared/SettingsSubsection";
import SettingsFlag from "../../../../element-web/apps/web/src/components/views/elements/SettingsFlag";
import { SettingLevel } from "../../../../element-web/apps/web/src/settings/SettingLevel";

// Plain string literals rather than _t()/_td() - matching every other Social app view (see e.g.
// SocialPostView.tsx's own "No replies yet"), none of which run through i18n. The setting's own
// displayName/description (rendered by SettingsFlag below) DO go through i18n as normal, since
// those live in Settings.tsx - a stock element-web file the i18n string scanner actually covers,
// unlike this one (outside element-web/apps/web/src entirely, per the whole Social app's own
// pluggable-app layout).
export function SocialSettingsTab(): JSX.Element {
    return (
        <SettingsSubsection heading="Posting" formWrap>
            <SettingsFlag name="Social.crossPostReplies" level={SettingLevel.ACCOUNT} />
        </SettingsSubsection>
    );
}

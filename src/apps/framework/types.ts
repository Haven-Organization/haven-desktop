import { type ComponentType } from "react";

/**
 * Definition of a Haven app: a full-width view that plugs into the space bar and the
 * UserMenu's apps list, alongside Element's normal rooms/spaces.
 */
export interface HavenApp {
    /** Stable id used as the account-data pin key and DOM data-app-id. Never change once shipped. */
    id: string;
    /** Display name shown in the apps picker and the space bar button tooltip. */
    name: string;
    /** Icon shown in the space bar button and apps picker. Ignored where `image` is set. */
    Icon: ComponentType<{ className?: string }>;
    /**
     * Optional custom square image (an imported asset URL, so it goes through webpack's asset
     * pipeline rather than being a raw string path) shown instead of `Icon` wherever the app's
     * glyph appears — lets an app use real branding instead of a generic Compound icon.
     */
    image?: string;
    /**
     * The dispatcher action string that, when dispatched, opens this app and becomes the
     * MatrixChat `page_type` while the app is active. Must be unique across all apps.
     */
    homeAction: string;
    /** Root view rendered full-width in place of the room list + room view while active. */
    Component: ComponentType<Record<string, never>>;
    /**
     * Optional settings page for this app, rendered inside the user settings dialog's "Apps" tab
     * (see AppsUserSettingsTab.tsx) when its own "Settings" button is clicked - apps with nothing
     * to configure can leave this unset, which just omits that button for them rather than linking
     * to an empty page. Renders directly inside AppsUserSettingsTab's own <SettingsSection> (whose
     * heading already reads "Apps: <app name>") - should contain its own <SettingsSubsection>(s)
     * only, no <SettingsTab>/<SettingsSection> or heading naming the app again (see
     * SocialSettingsTab.tsx for the reference shape).
     */
    SettingsComponent?: ComponentType<Record<string, never>>;
}

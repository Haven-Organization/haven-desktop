import { type HavenApp } from "./types";
import { socialApp } from "../social/app";
import { isAppEnabled } from "./config";
import { MatrixClientPeg } from "../../../element-web/apps/web/src/MatrixClientPeg";
import { getWidgetApps } from "./widgetApps/widgetAppRegistry";
import { getGameApps } from "./gameApps/gameAppRegistry";
import { isAppShownByUser } from "./appPreferences";

/** Every app pluggable into Haven's UserMenu apps list and space bar, before config filtering. */
const ALL_HAVEN_APPS: HavenApp[] = [socialApp];

/** The "haven.apps" config key that turns off adding room widgets to the apps list. */
export const WIDGET_APPS_CONFIG_KEY = "widgets";
/** Config key (haven.apps.games) for adding shared webxdc and Flash games to Apps (gameApps/). */
export const GAME_APPS_CONFIG_KEY = "games";

/**
 * Haven's built-in apps, per the "haven.apps" config: the ones with their own settings pages (see
 * AppsUserSettingsTab.tsx). The user's widget apps aren't included; see getLaunchableApps.
 */
export function getEnabledApps(): HavenApp[] {
    return ALL_HAVEN_APPS.filter((app) => isAppEnabled(app.id));
}

/** Whether users can add room widgets to their apps, per the "haven.apps" config. */
export function widgetAppsEnabled(): boolean {
    return isAppEnabled(WIDGET_APPS_CONFIG_KEY);
}

export function gameAppsEnabled(): boolean {
    return isAppEnabled(GAME_APPS_CONFIG_KEY);
}

/** Whether the host allows any kind of app at all, so Settings has an Apps tab. */
export function anyAppsAllowedByHost(): boolean {
    return getEnabledApps().length > 0 || widgetAppsEnabled() || gameAppsEnabled();
}

/**
 * Every app the host allows and the user has: built-in apps, then the user's widget apps, then
 * their game apps. Includes the ones the user hid or turned off (see appPreferences.ts), so
 * Settings > Apps can list them; everywhere else uses getLaunchableApps.
 */
export function getAllApps(): HavenApp[] {
    const client = MatrixClientPeg.get();
    const widgetApps = widgetAppsEnabled() ? getWidgetApps(client) : [];
    const gameApps = gameAppsEnabled() ? getGameApps(client) : [];
    return [...getEnabledApps(), ...widgetApps, ...gameApps];
}

/** Everything the apps picker and space bar can open: getAllApps, less what the user hid or turned off. */
export function getLaunchableApps(): HavenApp[] {
    const client = MatrixClientPeg.get();
    return getAllApps().filter((app) => isAppShownByUser(client, app.id));
}

export function getApp(id: string): HavenApp | undefined {
    return getLaunchableApps().find((app) => app.id === id);
}

export function getAppByHomeAction(action: string): HavenApp | undefined {
    return getLaunchableApps().find((app) => app.homeAction === action);
}

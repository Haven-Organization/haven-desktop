import { type HavenApp } from "./types";
import { socialApp } from "../social/app";
import { isAppEnabled } from "./config";

/** Every app pluggable into Haven's UserMenu apps list and space bar, before config filtering. */
const ALL_HAVEN_APPS: HavenApp[] = [socialApp];

/** Apps pluggable into Haven's UserMenu apps list and space bar, per the "haven.apps" config. */
export function getEnabledApps(): HavenApp[] {
    return ALL_HAVEN_APPS.filter((app) => isAppEnabled(app.id));
}

export function getApp(id: string): HavenApp | undefined {
    return getEnabledApps().find((app) => app.id === id);
}

export function getAppByHomeAction(action: string): HavenApp | undefined {
    return getEnabledApps().find((app) => app.homeAction === action);
}

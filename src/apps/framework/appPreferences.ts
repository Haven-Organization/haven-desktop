/*
 * Haven apps framework - the user's own choices about their apps, from Settings > Apps: turning
 * apps off altogether, and hiding individual apps (built-in ones, widgets and games) without
 * removing them. Kept in account data, like pins (pinnedApps.ts), so they follow the user across
 * devices.
 *
 * A hidden app, or any app while apps are turned off, is left out wherever apps can be opened:
 * the Apps button and picker, the space bar's pinned apps, and opening one by its action. Its pin
 * and its place in the user's apps are kept, so showing it again puts everything back.
 */

import { useEffect, useState } from "react";
import { ClientEvent, type MatrixClient, type MatrixEvent } from "matrix-js-sdk/src/matrix";

export const APP_PREFERENCES_EVENT_TYPE = "software.haven.app_preferences";

export interface AppPreferences {
    /** Every app turned off, as when the host turns them off in config. */
    disabled: boolean;
    /** Ids of apps the user has hidden. */
    hidden: string[];
}

// Same narrowly-typed escape hatch as pinnedApps.ts: Haven's account data type isn't part of the
// SDK's closed map of known types.
type UntypedAccountDataClient = {
    getAccountData(type: string): MatrixEvent | undefined;
    setAccountData(type: string, content: Record<string, unknown>): Promise<unknown>;
};
const asUntyped = (client: MatrixClient): UntypedAccountDataClient => client as unknown as UntypedAccountDataClient;

function preferencesFrom(ev: MatrixEvent | undefined): AppPreferences {
    const content = ev?.getContent() ?? {};
    const hidden = Array.isArray(content.hidden)
        ? content.hidden.filter((id): id is string => typeof id === "string")
        : [];
    return { disabled: content.disabled === true, hidden };
}

export function getAppPreferences(client: MatrixClient | null | undefined): AppPreferences {
    if (!client) return { disabled: false, hidden: [] };
    return preferencesFrom(asUntyped(client).getAccountData(APP_PREFERENCES_EVENT_TYPE));
}

/** Whether the user lets this app show: apps aren't turned off, and it isn't hidden. */
export function isAppShownByUser(client: MatrixClient | null | undefined, appId: string): boolean {
    const prefs = getAppPreferences(client);
    return !prefs.disabled && !prefs.hidden.includes(appId);
}

async function writePreferences(client: MatrixClient, next: AppPreferences): Promise<void> {
    // Keeps any fields a newer version of Haven added.
    const current = asUntyped(client).getAccountData(APP_PREFERENCES_EVENT_TYPE)?.getContent() ?? {};
    await asUntyped(client).setAccountData(APP_PREFERENCES_EVENT_TYPE, { ...current, ...next });
}

export function setAppsDisabled(client: MatrixClient, disabled: boolean): Promise<void> {
    return writePreferences(client, { ...getAppPreferences(client), disabled });
}

export function setAppHidden(client: MatrixClient, appId: string, hidden: boolean): Promise<void> {
    const prefs = getAppPreferences(client);
    const others = prefs.hidden.filter((id) => id !== appId);
    return writePreferences(client, { ...prefs, hidden: hidden ? [...others, appId] : others });
}

/** Live-updating {@link getAppPreferences}, kept in sync with account data across devices. */
export function useAppPreferences(client: MatrixClient): AppPreferences {
    const [prefs, setPrefs] = useState<AppPreferences>(() => getAppPreferences(client));

    useEffect(() => {
        setPrefs(getAppPreferences(client));
        const onAccountData = (ev: MatrixEvent): void => {
            if (ev.getType() === APP_PREFERENCES_EVENT_TYPE) setPrefs(getAppPreferences(client));
        };
        client.on(ClientEvent.AccountData, onAccountData);
        return () => {
            client.removeListener(ClientEvent.AccountData, onAccountData);
        };
    }, [client]);

    return prefs;
}

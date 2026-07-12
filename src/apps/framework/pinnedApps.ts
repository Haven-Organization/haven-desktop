import { useEffect, useState } from "react";
import { ClientEvent, type MatrixClient, type MatrixEvent } from "matrix-js-sdk/src/matrix";

/**
 * Account data event type storing which Haven apps are pinned to the space bar, so pins sync
 * across devices and persist across restarts. Mirrors the clone-mutate-write + echo-wait pattern
 * element-web already uses for `m.widgets` (see WidgetUtils.ts).
 */
export const PINNED_APPS_EVENT_TYPE = "software.haven.pinned_apps";

const WAIT_TIME_MS = 20000;

interface PinnedAppsContent {
    pinned?: string[];
}

// matrix-js-sdk types getAccountData/setAccountData against its own closed map of known event
// types; Haven's account data type isn't (and shouldn't be) part of that spec-defined map, so we
// go through a narrowly-typed escape hatch rather than widening the SDK's public types.
type UntypedAccountDataClient = {
    getAccountData(type: string): MatrixEvent | undefined;
    setAccountData(type: string, content: PinnedAppsContent): Promise<unknown>;
};
const asUntyped = (client: MatrixClient): UntypedAccountDataClient => client as unknown as UntypedAccountDataClient;

export function getPinnedAppIds(client: MatrixClient): string[] {
    return asUntyped(client).getAccountData(PINNED_APPS_EVENT_TYPE)?.getContent<PinnedAppsContent>()?.pinned ?? [];
}

function waitForPinnedAppsState(client: MatrixClient, appId: string, pinned: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
        const inIntendedState = (ev?: MatrixEvent): boolean => {
            const ids = ev?.getContent<PinnedAppsContent>()?.pinned ?? [];
            return ids.includes(appId) === pinned;
        };

        if (inIntendedState(asUntyped(client).getAccountData(PINNED_APPS_EVENT_TYPE))) {
            resolve();
            return;
        }

        const onAccountData = (ev: MatrixEvent): void => {
            if (ev.getType() !== PINNED_APPS_EVENT_TYPE) return;
            if (inIntendedState(ev)) {
                client.removeListener(ClientEvent.AccountData, onAccountData);
                clearTimeout(timerId);
                resolve();
            }
        };
        const timerId = window.setTimeout(() => {
            client.removeListener(ClientEvent.AccountData, onAccountData);
            reject(new Error(`Timed out waiting for pinned-apps update for ${appId}`));
        }, WAIT_TIME_MS);
        client.on(ClientEvent.AccountData, onAccountData);
    });
}

export async function setAppPinned(client: MatrixClient, appId: string, pinned: boolean): Promise<void> {
    const current = getPinnedAppIds(client);
    const next = pinned ? [...current.filter((id) => id !== appId), appId] : current.filter((id) => id !== appId);
    await asUntyped(client).setAccountData(PINNED_APPS_EVENT_TYPE, { pinned: next });
    await waitForPinnedAppsState(client, appId, pinned);
}

/** Live-updating list of pinned app ids, kept in sync with account data across devices. */
export function usePinnedAppIds(client: MatrixClient): string[] {
    const [pinned, setPinned] = useState<string[]>(() => getPinnedAppIds(client));

    useEffect(() => {
        setPinned(getPinnedAppIds(client));
        const onAccountData = (ev: MatrixEvent): void => {
            if (ev.getType() === PINNED_APPS_EVENT_TYPE) {
                setPinned(getPinnedAppIds(client));
            }
        };
        client.on(ClientEvent.AccountData, onAccountData);
        return () => {
            client.removeListener(ClientEvent.AccountData, onAccountData);
        };
    }, [client]);

    return pinned;
}

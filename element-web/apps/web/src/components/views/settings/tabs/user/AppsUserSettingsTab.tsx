/*
 * Haven apps framework — user settings "Apps" tab.
 *
 * A switch for apps as a whole, then every app the user has (built-in apps, and the widgets and
 * games they added from rooms; see apps/framework/registry.ts's getAllApps), each with a switch to
 * hide or show it (apps/framework/appPreferences.ts). Built-in apps with something to configure
 * (HavenApp.SettingsComponent) have a "Settings" button, which swaps this tab's own content to that
 * app's settings page, the same "list -> click through -> back" shape EmojiStickersUserSettingsTab.tsx
 * uses for an individual pack (see PackEditor.tsx). Added apps have a "Remove" button, the same as
 * "Remove from Apps" in their right-click menu (apps/framework/removeFromApps.ts).
 *
 * Turning apps off greys out every row's controls, leaving only the switch to turn them back on.
 */

import React, { type JSX, useCallback, useEffect, useState } from "react";
import classNames from "classnames";
import { Form, SettingsToggleInput } from "@vector-im/compound-web";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { _t } from "../../../../../languageHandler";
import SettingsTab from "../SettingsTab";
import { SettingsSection } from "../../shared/SettingsSection";
import { SettingsSubsection } from "../../shared/SettingsSubsection";
import AccessibleButton from "../../../elements/AccessibleButton";
import ToggleSwitch from "../../../elements/ToggleSwitch";
import { useMatrixClientContext } from "../../../../../contexts/MatrixClientContext";
import { gameAppsEnabled, getAllApps } from "../../../../../../../../../src/apps/framework/registry";
import { type HavenApp } from "../../../../../../../../../src/apps/framework/types";
import {
    setAppHidden,
    setAppsDisabled,
    useAppPreferences,
} from "../../../../../../../../../src/apps/framework/appPreferences";
import { confirmRemoveFromApps } from "../../../../../../../../../src/apps/framework/removeFromApps";
import {
    findWidgetAppEntryByAppId,
    useWidgetAppEntries,
} from "../../../../../../../../../src/apps/framework/widgetApps/widgetApps";
import {
    findGameAppEntryByAppId,
    GAME_APPS_EVENT_TYPE,
    gameAppId,
    useGameAppEntries,
} from "../../../../../../../../../src/apps/framework/gameApps/gameApps";
import {
    cachedBytes,
    clearGameFileCache,
    MAX_TOTAL_BYTES,
    pruneGameFileCache,
} from "../../../../../../../../../src/apps/framework/gameApps/gameFileCache";
import { fileSize } from "../../../../../utils/FileUtils";

/** What kind of app a row is, and where an added one came from. */
function appOrigin(client: MatrixClient, app: HavenApp): { kind: "builtin" | "added"; label: string } {
    const widget = findWidgetAppEntryByAppId(client, app.id);
    if (widget) {
        const room = client.getRoom(widget.room_id)?.name ?? widget.room_name;
        return { kind: "added", label: room ? `Widget from ${room}` : "Widget" };
    }
    const game = findGameAppEntryByAppId(client, app.id);
    if (game) {
        const kind = game.flash ? "Flash game" : "Game";
        const room = client.getRoom(game.room_id)?.name ?? game.room_name;
        return { kind: "added", label: room ? `${kind} from ${room}` : kind };
    }
    return { kind: "builtin", label: "Built in" };
}

function logFailure(what: string): (e: unknown) => void {
    return (e) => logger.warn(`Couldn't ${what}`, e);
}

export default function AppsUserSettingsTab(): JSX.Element {
    const client = useMatrixClientContext();
    // Re-render when the user's apps or their choices about them change.
    useWidgetAppEntries(client);
    useGameAppEntries(client);
    const prefs = useAppPreferences(client);
    const apps = getAllApps();
    const [openAppId, setOpenAppId] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
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

    const onToggleAll = (enabled: boolean): void => {
        setBusy(true);
        setAppsDisabled(client, !enabled)
            .catch(logFailure("turn apps on or off"))
            .finally(() => setBusy(false));
    };

    return (
        <SettingsTab>
            <SettingsSection heading={_t("settings|apps|title")}>
                <SettingsSubsection formWrap>
                    <Form.Root
                        onSubmit={(evt) => {
                            evt.preventDefault();
                            evt.stopPropagation();
                        }}
                    >
                        <SettingsToggleInput
                            name="haven_apps_enabled"
                            label="Enable apps"
                            helpMessage="Turning this off hides the Apps button and all your apps, including pinned ones. Nothing is removed."
                            checked={!prefs.disabled}
                            onChange={(evt) => onToggleAll(evt.target.checked)}
                            disabled={busy}
                        />
                    </Form.Root>
                    <div
                        className={classNames("mx_AppsUserSettingsTab_appList", {
                            mx_AppsUserSettingsTab_appList_disabled: prefs.disabled,
                        })}
                        aria-disabled={prefs.disabled}
                    >
                        {apps.map((app) => (
                            <AppRow
                                key={app.id}
                                client={client}
                                app={app}
                                shown={!prefs.hidden.includes(app.id)}
                                disabled={prefs.disabled}
                                onOpenSettings={() => setOpenAppId(app.id)}
                            />
                        ))}
                    </div>
                </SettingsSubsection>
                {gameAppsEnabled() && <GameCacheSubsection client={client} />}
            </SettingsSection>
        </SettingsTab>
    );
}

/** The device cache of game apps' files (gameFileCache.ts): how much it holds, and emptying it. */
function GameCacheSubsection({ client }: { client: MatrixClient }): JSX.Element {
    const games = useGameAppEntries(client);
    const [bytes, setBytes] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);

    const refresh = useCallback((): void => {
        cachedBytes().then(setBytes, (e) => {
            logger.warn("Couldn't read the game file cache", e);
            setBytes(null);
        });
    }, []);

    // Drops files of games removed on other devices first. Only once the list of games has been
    // synced at all, so an unsynced (empty) list doesn't empty the cache.
    const synced = !!client.getAccountData(GAME_APPS_EVENT_TYPE as never);
    useEffect(() => {
        const prune = synced
            ? pruneGameFileCache(games.map((g) => gameAppId(g.room_id, g.event_id)))
            : Promise.resolve();
        prune.catch(logFailure("tidy the game file cache")).finally(refresh);
    }, [synced, games, refresh]);

    const onClear = (): void => {
        setBusy(true);
        clearGameFileCache()
            .catch(logFailure("clear the game file cache"))
            .finally(() => {
                setBusy(false);
                refresh();
            });
    };

    return (
        <SettingsSubsection
            heading="Game cache"
            description={
                "Games in your apps are kept on this device so they open without downloading again. " +
                "The games played longest ago make room for new ones."
            }
        >
            <div className="mx_AppsUserSettingsTab_cacheRow">
                <span>
                    {bytes === null
                        ? "Not available on this device"
                        : `${fileSize(bytes)} of ${fileSize(MAX_TOTAL_BYTES)} used`}
                </span>
                <AccessibleButton kind="danger_outline" onClick={onClear} disabled={busy || !bytes}>
                    Clear
                </AccessibleButton>
            </div>
        </SettingsSubsection>
    );
}

interface AppRowProps {
    client: MatrixClient;
    app: HavenApp;
    /** Whether the user shows this app (not hidden). */
    shown: boolean;
    /** Whether apps are turned off altogether, which greys out every control. */
    disabled: boolean;
    onOpenSettings: () => void;
}

function AppRow({ client, app, shown, disabled, onOpenSettings }: AppRowProps): JSX.Element {
    const [busy, setBusy] = useState(false);
    const origin = appOrigin(client, app);

    const onToggle = (show: boolean): void => {
        setBusy(true);
        setAppHidden(client, app.id, !show)
            .catch(logFailure("show or hide an app"))
            .finally(() => setBusy(false));
    };

    return (
        <div className="mx_AppsUserSettingsTab_appRow">
            <div className="mx_AppsUserSettingsTab_appRowLabel">
                {app.image ? (
                    <img className="mx_AppsUserSettingsTab_avatar" src={app.image} alt="" />
                ) : (
                    <app.Icon className="mx_AppsUserSettingsTab_avatar" />
                )}
                <div className="mx_AppsUserSettingsTab_appText">
                    <span className="mx_AppsUserSettingsTab_appName">{app.name}</span>
                    <span className="mx_AppsUserSettingsTab_appOrigin">{origin.label}</span>
                </div>
            </div>
            {app.SettingsComponent && (
                <AccessibleButton kind="primary_outline" onClick={onOpenSettings} disabled={disabled}>
                    {_t("common|settings")}
                </AccessibleButton>
            )}
            {origin.kind === "added" && (
                <AccessibleButton
                    kind="danger_outline"
                    onClick={() => void confirmRemoveFromApps(client, app.id, app.name)}
                    disabled={disabled}
                >
                    Remove
                </AccessibleButton>
            )}
            <ToggleSwitch checked={shown} onChange={onToggle} disabled={disabled || busy} title={`Show ${app.name}`} />
        </div>
    );
}

/*
 * Haven apps framework - games added to the user's apps
 *
 * A webxdc or Flash game shared as a file in a room can be added to the user's apps, from the
 * "Add to Apps" button on its card. Like a widget app (widgetApps/), it's a link: to the message
 * the game was shared in, which the game's moves and saves already belong to. It's stored in the
 * user's account data, with its name and a small copy of its icon, so the space bar can show it
 * without downloading the game.
 *
 * The game's page (GameAppView.tsx) plays it full size. When the message is gone, or the user left
 * its room, the page says so, and offers "Remove from Apps".
 */

import { ClientEvent, type MatrixClient, type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { useEffect, useState } from "react";

import defaultDispatcher from "../../../../element-web/apps/web/src/dispatcher/dispatcher";
import { Action } from "../../../../element-web/apps/web/src/dispatcher/actions";
import { setAppPinned } from "../pinnedApps";

export const GAME_APPS_EVENT_TYPE = "software.haven.game_apps";

const WAIT_TIME_MS = 20000;

export interface GameAppEntry {
    room_id: string;
    event_id: string;
    /** The game's id (webxdcGameId), which its sandbox is made from. */
    game_id: string;
    name: string;
    /** A small copy of the game's own icon, as a data: URL. */
    icon?: string;
    /** A Flash game (.swf) rather than a webxdc one. */
    flash?: boolean;
    /** The room's name when added, shown if the user is no longer in the room. */
    room_name?: string;
}

interface GameAppsContent {
    games?: unknown;
}

// Same narrowly-typed escape hatch as pinnedApps.ts: Haven's account data type isn't part of the
// SDK's closed map of known types.
type UntypedAccountDataClient = {
    getAccountData(type: string): MatrixEvent | undefined;
    setAccountData(type: string, content: GameAppsContent): Promise<unknown>;
};
const asUntyped = (client: MatrixClient): UntypedAccountDataClient => client as unknown as UntypedAccountDataClient;

function isEntry(value: unknown): value is GameAppEntry {
    if (typeof value !== "object" || value === null) return false;
    const e = value as Record<string, unknown>;
    return (
        typeof e.room_id === "string" &&
        typeof e.event_id === "string" &&
        typeof e.game_id === "string" &&
        typeof e.name === "string" &&
        (e.icon === undefined || (typeof e.icon === "string" && e.icon.startsWith("data:image/")))
    );
}

function entriesFrom(ev: MatrixEvent | undefined): GameAppEntry[] {
    const games = ev?.getContent<GameAppsContent>()?.games;
    return Array.isArray(games) ? games.filter(isEntry) : [];
}

const sameGame = (e: GameAppEntry, roomId: string, eventId: string): boolean =>
    e.room_id === roomId && e.event_id === eventId;

/** The id a game app is pinned under, and its space bar button's data-app-id. */
export function gameAppId(roomId: string, eventId: string): string {
    return `game:${roomId}/${eventId}`;
}

/** The dispatcher action that opens a game app (and its MatrixChat page_type while open). */
export function gameAppHomeAction(roomId: string, eventId: string): string {
    return `haven_view_game_app:${roomId}/${eventId}`;
}

export function getGameAppEntries(client: MatrixClient): GameAppEntry[] {
    return entriesFrom(asUntyped(client).getAccountData(GAME_APPS_EVENT_TYPE));
}

/** The game app behind an app id from gameAppId(), if it is one. */
export function findGameAppEntryByAppId(client: MatrixClient, appId: string): GameAppEntry | undefined {
    return getGameAppEntries(client).find((e) => gameAppId(e.room_id, e.event_id) === appId);
}

export function findGameAppEntry(client: MatrixClient, roomId: string, eventId: string): GameAppEntry | undefined {
    return getGameAppEntries(client).find((e) => sameGame(e, roomId, eventId));
}

async function writeEntries(
    client: MatrixClient,
    entries: GameAppEntry[],
    done: (entries: GameAppEntry[]) => boolean,
): Promise<void> {
    await asUntyped(client).setAccountData(GAME_APPS_EVENT_TYPE, { games: entries });
    // Wait for the echo, as pinnedApps.ts does, so a read right after this sees the change.
    await new Promise<void>((resolve, reject) => {
        if (done(getGameAppEntries(client))) {
            resolve();
            return;
        }
        const onAccountData = (ev: MatrixEvent): void => {
            if (ev.getType() !== GAME_APPS_EVENT_TYPE || !done(entriesFrom(ev))) return;
            client.removeListener(ClientEvent.AccountData, onAccountData);
            clearTimeout(timerId);
            resolve();
        };
        const timerId = window.setTimeout(() => {
            client.removeListener(ClientEvent.AccountData, onAccountData);
            reject(new Error("Timed out waiting for the game apps update"));
        }, WAIT_TIME_MS);
        client.on(ClientEvent.AccountData, onAccountData);
    });
}

/** Adds the game to the user's apps and pins it to the space bar. */
export async function addGameApp(client: MatrixClient, entry: GameAppEntry): Promise<void> {
    const others = getGameAppEntries(client).filter((e) => !sameGame(e, entry.room_id, entry.event_id));
    await writeEntries(client, [...others, entry], (now) =>
        now.some((e) => sameGame(e, entry.room_id, entry.event_id)),
    );
    await setAppPinned(client, gameAppId(entry.room_id, entry.event_id), true);
}

/** Updates what's stored for a game app, such as its icon once the game has been read. */
export async function updateGameAppEntry(client: MatrixClient, entry: GameAppEntry): Promise<void> {
    const entries = getGameAppEntries(client);
    if (!entries.some((e) => sameGame(e, entry.room_id, entry.event_id))) return;
    const updated = entries.map((e) => (sameGame(e, entry.room_id, entry.event_id) ? entry : e));
    await writeEntries(client, updated, (now) =>
        now.some((e) => sameGame(e, entry.room_id, entry.event_id) && e.icon === entry.icon && e.name === entry.name),
    );
}

/** The game app whose page is open, if any (set by GameAppView). */
let openGameAppId: string | null = null;

export function noteGameAppOpen(appId: string | null): void {
    openGameAppId = appId;
}

/** Removes the game from the user's apps, and its space bar pin. */
export async function removeGameApp(client: MatrixClient, roomId: string, eventId: string): Promise<void> {
    // Leave its page first: once it's gone from the list, nothing renders that page.
    if (gameAppId(roomId, eventId) === openGameAppId) {
        defaultDispatcher.dispatch({ action: Action.ViewHomePage }, true);
    }
    const entries = getGameAppEntries(client);
    if (entries.some((e) => sameGame(e, roomId, eventId))) {
        await writeEntries(
            client,
            entries.filter((e) => !sameGame(e, roomId, eventId)),
            (now) => !now.some((e) => sameGame(e, roomId, eventId)),
        );
    }
    await setAppPinned(client, gameAppId(roomId, eventId), false);
}

/** Live list of the user's game apps, kept in sync with account data across devices. */
export function useGameAppEntries(client: MatrixClient): GameAppEntry[] {
    const [entries, setEntries] = useState<GameAppEntry[]>(() => getGameAppEntries(client));

    useEffect(() => {
        setEntries(getGameAppEntries(client));
        const onAccountData = (ev: MatrixEvent): void => {
            if (ev.getType() === GAME_APPS_EVENT_TYPE) setEntries(getGameAppEntries(client));
        };
        client.on(ClientEvent.AccountData, onAccountData);
        return () => {
            client.removeListener(ClientEvent.AccountData, onAccountData);
        };
    }, [client]);

    return entries;
}

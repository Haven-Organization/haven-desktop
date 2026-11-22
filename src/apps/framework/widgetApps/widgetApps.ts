/*
 * Haven apps framework - room widgets added to the user's apps
 *
 * A user can add any widget in a room they're in to their apps, so it opens full-width from the
 * apps picker or the space bar like a built-in app. The app is a link to the widget, not a copy:
 * it's stored as {room_id, widget_id} and always loads the room's current widget, in that room
 * (widgets read their room from the URL and act in it, so a copy cut off from its room wouldn't
 * work, and would miss the changes bridges make to their widgets).
 *
 * The list lives in account data, so it syncs across devices. Each entry also keeps the widget's
 * last state content: when someone else removes the widget from the room, a user allowed to add
 * widgets there can put it back as it was (see recreateWidget), under the same widget id, so the
 * link works again unchanged.
 *
 * Built-in apps are pinned to the space bar through pinnedApps.ts; a widget app's pin uses the
 * same list, under widgetAppId().
 */

import { ClientEvent, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";
import { useEffect, useState } from "react";

import defaultDispatcher from "../../../../element-web/apps/web/src/dispatcher/dispatcher";
import { Action } from "../../../../element-web/apps/web/src/dispatcher/actions";
import { setAppPinned } from "../pinnedApps";
import { allowWidgetEvent } from "./widgetConsent";

export const WIDGET_APPS_EVENT_TYPE = "software.haven.widget_apps";

/** The widget state event type Element reads, and so the one that decides whether a widget is there. */
export const LEGACY_WIDGET_TYPE = "im.vector.modular.widgets";
/** The newer type some bridges also write. Element doesn't read it, but "Add it back" restores it. */
export const WIDGET_TYPE = "m.widget";
const WIDGET_STATE_TYPES = [LEGACY_WIDGET_TYPE, WIDGET_TYPE];

const WAIT_TIME_MS = 20000;

export interface WidgetAppEntry {
    room_id: string;
    widget_id: string;
    /** The room's name when last seen, shown if the user is no longer in the room. */
    room_name?: string;
    /** The state event types the widget was set under, which "Add it back" writes again. */
    state_types: string[];
    /** The widget's state content when last seen: what "Add it back" restores. */
    content: Record<string, unknown>;
    /** Who last set the widget. */
    sender: string;
}

interface WidgetAppsContent {
    widgets?: unknown;
}

// Same narrowly-typed escape hatch as pinnedApps.ts: Haven's account data type isn't part of the
// SDK's closed map of known types.
type UntypedAccountDataClient = {
    getAccountData(type: string): MatrixEvent | undefined;
    setAccountData(type: string, content: WidgetAppsContent): Promise<unknown>;
};
const asUntyped = (client: MatrixClient): UntypedAccountDataClient => client as unknown as UntypedAccountDataClient;

function isEntry(value: unknown): value is WidgetAppEntry {
    if (typeof value !== "object" || value === null) return false;
    const e = value as Record<string, unknown>;
    return (
        typeof e.room_id === "string" &&
        typeof e.widget_id === "string" &&
        Array.isArray(e.state_types) &&
        e.state_types.every((t) => typeof t === "string") &&
        typeof e.content === "object" &&
        e.content !== null &&
        typeof e.sender === "string"
    );
}

function entriesFrom(ev: MatrixEvent | undefined): WidgetAppEntry[] {
    const widgets = ev?.getContent<WidgetAppsContent>()?.widgets;
    return Array.isArray(widgets) ? widgets.filter(isEntry) : [];
}

const sameWidget = (e: WidgetAppEntry, roomId: string, widgetId: string): boolean =>
    e.room_id === roomId && e.widget_id === widgetId;

/** The id a widget app is pinned under, and its space bar button's data-app-id. */
export function widgetAppId(roomId: string, widgetId: string): string {
    return `widget:${roomId}/${widgetId}`;
}

/** The dispatcher action that opens a widget app (and its MatrixChat page_type while open). */
export function widgetAppHomeAction(roomId: string, widgetId: string): string {
    return `haven_view_widget_app:${roomId}/${widgetId}`;
}

export function getWidgetAppEntries(client: MatrixClient): WidgetAppEntry[] {
    return entriesFrom(asUntyped(client).getAccountData(WIDGET_APPS_EVENT_TYPE));
}

/** The widget app behind an app id from widgetAppId(), if it is one. */
export function findWidgetAppEntryByAppId(client: MatrixClient, appId: string): WidgetAppEntry | undefined {
    return getWidgetAppEntries(client).find((e) => widgetAppId(e.room_id, e.widget_id) === appId);
}

export function findWidgetAppEntry(client: MatrixClient, roomId: string, widgetId: string): WidgetAppEntry | undefined {
    return getWidgetAppEntries(client).find((e) => sameWidget(e, roomId, widgetId));
}

async function writeEntries(
    client: MatrixClient,
    entries: WidgetAppEntry[],
    done: (entries: WidgetAppEntry[]) => boolean,
): Promise<void> {
    await asUntyped(client).setAccountData(WIDGET_APPS_EVENT_TYPE, { widgets: entries });
    // Wait for the echo, as pinnedApps.ts does, so a read right after this sees the change.
    await new Promise<void>((resolve, reject) => {
        if (done(getWidgetAppEntries(client))) {
            resolve();
            return;
        }
        const onAccountData = (ev: MatrixEvent): void => {
            if (ev.getType() !== WIDGET_APPS_EVENT_TYPE || !done(entriesFrom(ev))) return;
            client.removeListener(ClientEvent.AccountData, onAccountData);
            clearTimeout(timerId);
            resolve();
        };
        const timerId = window.setTimeout(() => {
            client.removeListener(ClientEvent.AccountData, onAccountData);
            reject(new Error("Timed out waiting for the widget apps update"));
        }, WAIT_TIME_MS);
        client.on(ClientEvent.AccountData, onAccountData);
    });
}

/** The widget's current state event in the room (the type Element reads), if it has one at all. */
export function getWidgetStateEvent(room: Room, widgetId: string): MatrixEvent | null {
    return room.currentState.getStateEvents(LEGACY_WIDGET_TYPE, widgetId) ?? null;
}

/** Whether the room currently has the widget: a removed widget's state is left empty. */
export function isWidgetPresent(room: Room, widgetId: string): boolean {
    return !!getWidgetStateEvent(room, widgetId)?.getContent()?.url;
}

/** An entry for the widget as the room has it now, or null when the room doesn't have it. */
export function entryForCurrentWidget(room: Room, widgetId: string): WidgetAppEntry | null {
    const ev = getWidgetStateEvent(room, widgetId);
    if (!ev?.getContent()?.url) return null;
    const stateTypes = WIDGET_STATE_TYPES.filter(
        (type) => !!room.currentState.getStateEvents(type, widgetId)?.getContent()?.url,
    );
    return {
        room_id: room.roomId,
        widget_id: widgetId,
        room_name: room.name,
        state_types: stateTypes,
        content: ev.getContent(),
        sender: ev.getSender() ?? "",
    };
}

/** Whether an entry already matches what the room has, so there's nothing to update. */
export function entryMatches(a: WidgetAppEntry, b: WidgetAppEntry): boolean {
    return (
        a.room_name === b.room_name &&
        a.sender === b.sender &&
        JSON.stringify(a.state_types) === JSON.stringify(b.state_types) &&
        JSON.stringify(a.content) === JSON.stringify(b.content)
    );
}

/** Adds the room's widget to the user's apps, and pins it to the space bar. */
export async function addWidgetApp(client: MatrixClient, room: Room, widgetId: string): Promise<void> {
    const entry = entryForCurrentWidget(room, widgetId);
    if (!entry) throw new Error(`Room ${room.roomId} has no widget ${widgetId}`);
    // Adding it is saying yes to loading it, so the apps page doesn't ask again.
    const eventId = getWidgetStateEvent(room, widgetId)?.getId();
    if (eventId) await allowWidgetEvent(room.roomId, eventId);
    const others = getWidgetAppEntries(client).filter((e) => !sameWidget(e, room.roomId, widgetId));
    await writeEntries(client, [...others, entry], (entries) =>
        entries.some((e) => sameWidget(e, room.roomId, widgetId)),
    );
    await setAppPinned(client, widgetAppId(room.roomId, widgetId), true);
}

/** Replaces the stored entry for a widget with a newer one (e.g. after the widget changed). */
export async function updateWidgetAppEntry(client: MatrixClient, entry: WidgetAppEntry): Promise<void> {
    const entries = getWidgetAppEntries(client);
    if (!entries.some((e) => sameWidget(e, entry.room_id, entry.widget_id))) return;
    await writeEntries(
        client,
        entries.map((e) => (sameWidget(e, entry.room_id, entry.widget_id) ? entry : e)),
        (now) => now.some((e) => sameWidget(e, entry.room_id, entry.widget_id) && entryMatches(e, entry)),
    );
}

/** The widget app whose page is open, if any (set by WidgetAppView). */
let openWidgetAppId: string | null = null;

export function noteWidgetAppOpen(appId: string | null): void {
    openWidgetAppId = appId;
}

/** Removes widgets from the user's apps (and their space bar pins), in one write. */
export async function removeWidgetApps(
    client: MatrixClient,
    widgets: { roomId: string; widgetId: string }[],
): Promise<void> {
    // Leave a removed app's page first: once it's gone from the list, nothing renders that page.
    if (widgets.some((w) => widgetAppId(w.roomId, w.widgetId) === openWidgetAppId)) {
        defaultDispatcher.dispatch({ action: Action.ViewHomePage }, true);
    }
    const isRemoved = (e: WidgetAppEntry): boolean => widgets.some((w) => sameWidget(e, w.roomId, w.widgetId));
    const entries = getWidgetAppEntries(client);
    if (entries.some(isRemoved)) {
        await writeEntries(
            client,
            entries.filter((e) => !isRemoved(e)),
            (now) => !now.some(isRemoved),
        );
    }
    for (const w of widgets) {
        await setAppPinned(client, widgetAppId(w.roomId, w.widgetId), false);
    }
}

export function removeWidgetApp(client: MatrixClient, roomId: string, widgetId: string): Promise<void> {
    return removeWidgetApps(client, [{ roomId, widgetId }]);
}

/** The state types "Add it back" writes: the ones the widget had, always including Element's. */
function typesToRecreate(entry: WidgetAppEntry): string[] {
    return entry.state_types.includes(LEGACY_WIDGET_TYPE)
        ? entry.state_types
        : [LEGACY_WIDGET_TYPE, ...entry.state_types];
}

/** Whether the user may put the widget back in the room: they need to be able to send each type. */
export function canRecreateWidget(client: MatrixClient, room: Room, entry: WidgetAppEntry): boolean {
    const me = client.getUserId();
    if (!me) return false;
    return typesToRecreate(entry).every((type) => room.currentState.maySendStateEvent(type, me));
}

/**
 * Puts a removed widget back in its room as it was last seen, under the same widget id and the
 * same state types, so the user's link to it works again.
 */
export async function recreateWidget(client: MatrixClient, entry: WidgetAppEntry): Promise<void> {
    for (const type of typesToRecreate(entry)) {
        // The SDK's sendStateEvent is typed against its own map of known state events.
        await (
            client as unknown as {
                sendStateEvent(roomId: string, type: string, content: object, stateKey: string): Promise<unknown>;
            }
        ).sendStateEvent(entry.room_id, type, entry.content, entry.widget_id);
    }
}

/** Live list of the user's widget apps, kept in sync with account data across devices. */
export function useWidgetAppEntries(client: MatrixClient): WidgetAppEntry[] {
    const [entries, setEntries] = useState<WidgetAppEntry[]>(() => getWidgetAppEntries(client));

    useEffect(() => {
        setEntries(getWidgetAppEntries(client));
        const onAccountData = (ev: MatrixEvent): void => {
            if (ev.getType() === WIDGET_APPS_EVENT_TYPE) setEntries(getWidgetAppEntries(client));
        };
        client.on(ClientEvent.AccountData, onAccountData);
        return () => {
            client.removeListener(ClientEvent.AccountData, onAccountData);
        };
    }, [client]);

    return entries;
}

/** Past this many characters, menus say "Go to room" rather than stretching to fit the room's name. */
const MAX_ROOM_NAME_IN_MENU = 32;

/** The label of a menu item that opens a widget app's room. */
export function goToRoomLabel(roomName: string): string {
    return [...roomName].length > MAX_ROOM_NAME_IN_MENU ? "Go to room" : `Go to ${roomName}`;
}

/*
 * Haven apps framework - drop widget apps the user removed from their rooms themselves
 *
 * When the user removes a widget from a room (here or on another device), they meant to, so its
 * app goes too, without asking. When someone else removes it, the app stays, and its page says
 * what happened and offers to put it back (see WidgetAppView.tsx).
 *
 * Also keeps each stored entry in step with its widget when the room changes it (a bridge's new
 * icon or name), so the spaces bar shows the current look without opening the app first.
 *
 * Checks every widget app once when mounted, which catches changes made while this client was
 * closed, then watches for new ones. Mounted once, by SpacePanelAppButtons: SpacePanel stays
 * mounted for the whole session, even while the spaces bar is hidden.
 */

import { useEffect } from "react";
import { type MatrixClient, type MatrixEvent, RoomStateEvent, KnownMembership } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import {
    getWidgetAppEntries,
    getWidgetStateEvent,
    LEGACY_WIDGET_TYPE,
    refreshWidgetAppEntry,
    removeWidgetApps,
    WIDGET_STATE_TYPES,
} from "./widgetApps";

/** Whether this state event is the user removing a widget. */
export function isOwnRemoval(ev: MatrixEvent | null, me: string): boolean {
    return !!ev && ev.getType() === LEGACY_WIDGET_TYPE && ev.getSender() === me && !ev.getContent()?.url;
}

/** The user's widget apps whose widgets they've since removed from the room themselves. */
export function findOwnRemovals(client: MatrixClient): { roomId: string; widgetId: string }[] {
    const me = client.getUserId();
    if (!me) return [];
    return getWidgetAppEntries(client)
        .filter((entry) => {
            const room = client.getRoom(entry.room_id);
            if (room?.getMyMembership() !== KnownMembership.Join) return false;
            return isOwnRemoval(getWidgetStateEvent(room, entry.widget_id), me);
        })
        .map((entry) => ({ roomId: entry.room_id, widgetId: entry.widget_id }));
}

export function useWidgetAppsWatcher(client: MatrixClient): void {
    useEffect(() => {
        const remove = (widgets: { roomId: string; widgetId: string }[]): void => {
            if (!widgets.length) return;
            removeWidgetApps(client, widgets).catch((e) => logger.warn("Couldn't remove a removed widget's app", e));
        };

        // One at a time: each rewrites the whole account data list, so parallel ones could undo each other.
        let refreshing: Promise<void> = Promise.resolve();
        const refresh = (roomId: string, widgetId?: string): void => {
            refreshing = refreshing.then(async () => {
                const room = client.getRoom(roomId);
                if (room?.getMyMembership() !== KnownMembership.Join) return;
                for (const entry of getWidgetAppEntries(client)) {
                    if (entry.room_id !== roomId || (widgetId !== undefined && entry.widget_id !== widgetId)) continue;
                    await refreshWidgetAppEntry(client, room, entry).catch((e) =>
                        logger.warn("Couldn't update a widget app", e),
                    );
                }
            });
        };

        remove(findOwnRemovals(client));
        for (const roomId of new Set(getWidgetAppEntries(client).map((e) => e.room_id))) refresh(roomId);

        const onStateEvent = (ev: MatrixEvent): void => {
            const me = client.getUserId();
            const roomId = ev.getRoomId();
            if (!me || !roomId) return;
            // A widget changed (not removed): refreshWidgetAppEntry skips entries already in step.
            if (WIDGET_STATE_TYPES.includes(ev.getType()) && ev.getContent()?.url) {
                refresh(roomId, ev.getStateKey());
                return;
            }
            if (!isOwnRemoval(ev, me)) return;
            const widgetId = ev.getStateKey();
            if (widgetId === undefined) return;
            if (getWidgetAppEntries(client).some((e) => e.room_id === roomId && e.widget_id === widgetId)) {
                remove([{ roomId, widgetId }]);
            }
        };
        client.on(RoomStateEvent.Events, onStateEvent);
        return () => {
            client.removeListener(RoomStateEvent.Events, onStateEvent);
        };
    }, [client]);
}

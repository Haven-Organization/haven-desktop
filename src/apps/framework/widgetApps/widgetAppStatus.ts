/*
 * Haven apps framework - whether a widget app's widget can be shown, and why not when it can't.
 * See WidgetAppView.tsx, which shows it, and popOutWidgetApp.ts.
 */

import { KnownMembership, type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

import WidgetStore, { type IApp } from "../../../../element-web/apps/web/src/stores/WidgetStore";
import WidgetUtils from "../../../../element-web/apps/web/src/utils/WidgetUtils";
import { getWidgetStateEvent } from "./widgetApps";

export type WidgetAppStatus =
    | { kind: "available"; room: Room; app: IApp }
    /** The widget's state is empty: removedBy is whoever emptied it, when the room says. */
    | { kind: "removed"; room: Room; removedBy: string | null }
    | { kind: "upgraded"; room: Room; newRoomId: string }
    | { kind: "left"; room: Room | null };

/** Where the widget stands now, for the page to show. */
export function getWidgetAppStatus(client: MatrixClient, roomId: string, widgetId: string): WidgetAppStatus {
    const room = client.getRoom(roomId);
    if (!room || room.getMyMembership() !== KnownMembership.Join) return { kind: "left", room };

    const ev = getWidgetStateEvent(room, widgetId);
    if (ev?.getContent()?.url) {
        const app =
            WidgetStore.instance.getApps(roomId).find((a) => a.id === widgetId) ??
            WidgetUtils.makeAppConfig(widgetId, ev.getContent(), ev.getSender()!, roomId, ev.getId());
        return { kind: "available", room, app };
    }

    const newRoomId = room.currentState.getStateEvents("m.room.tombstone", "")?.getContent()?.replacement_room;
    if (typeof newRoomId === "string" && newRoomId) return { kind: "upgraded", room, newRoomId };

    return { kind: "removed", room, removedBy: ev?.getSender() ?? null };
}

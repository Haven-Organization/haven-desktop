/*
 * Haven apps framework - pops a game app out into its own window from outside its page, such as
 * its right-click menu in the space bar.
 *
 * The same pop-out as the one on the game's card (WebxdcPopoutStore.ts): the window opens straight
 * from the click, and the game is fetched while it does. A game playing on its page pops out from
 * there instead (GameAppView.tsx), handing over what it hasn't saved.
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import defaultDispatcher from "../../../../element-web/apps/web/src/dispatcher/dispatcher";
import { webxdcSandbox } from "../../../../element-web/apps/web/src/utils/webxdc";
import { WebxdcPopoutStore } from "../../../../element-web/apps/web/src/utils/WebxdcPopoutStore";
import { showPopoutRefusedDialog } from "../widgetPopout/WidgetPoppedOut";
import { gameAppHomeAction, type GameAppEntry } from "./gameApps";
import { fetchGameEvent, isGameEvent, isInRoom, readGameArchive } from "./gameEvent";

/** Pops the game out. Must be called from a click, or popup blockers refuse the window. */
export function popOutGameApp(client: MatrixClient, entry: GameAppEntry): void {
    const { room_id: roomId, event_id: eventId } = entry;
    // Not in the room any more: the game's page says so.
    if (!isInRoom(client, roomId)) {
        defaultDispatcher.dispatch({ action: gameAppHomeAction(roomId, eventId) });
        return;
    }
    const opened = WebxdcPopoutStore.instance.popOut({
        client,
        roomId,
        eventId,
        archive: (async () => {
            const event = await fetchGameEvent(client, roomId, eventId).catch(() => null);
            return event && isGameEvent(event) ? readGameArchive(event, entry) : undefined;
        })(),
        sandbox: webxdcSandbox(entry.game_id),
        name: entry.name,
        onFailed: showPopoutRefusedDialog,
        onProblem: (problem) => logger.warn("A popped-out game app stopped", problem),
    });
    if (!opened) showPopoutRefusedDialog();
}

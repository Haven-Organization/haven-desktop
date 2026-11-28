/*
 * Haven apps framework - "Remove from Apps" for the apps a user added from rooms (room widgets and
 * shared webxdc or Flash games), with the confirmation every way of removing one goes through: the
 * space bar's right-click menu, an app page's "..." menu and notices, and Settings > Apps.
 *
 * Removing one only drops the user's link to it: the widget or game stays where it came from, and
 * the confirmation says so, so they know they can add it back from there.
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import Modal from "../../../element-web/apps/web/src/Modal";
import QuestionDialog from "../../../element-web/apps/web/src/components/views/dialogs/QuestionDialog";
import ErrorDialog from "../../../element-web/apps/web/src/components/views/dialogs/ErrorDialog";
import { findWidgetAppEntryByAppId, removeWidgetApp } from "./widgetApps/widgetApps";
import { findGameAppEntryByAppId, removeGameApp } from "./gameApps/gameApps";

/** What kind of added app `appId` is, or undefined for a built-in app (which can't be removed). */
export function getRemovableAppKind(client: MatrixClient, appId: string): "widget" | "game" | undefined {
    if (findWidgetAppEntryByAppId(client, appId)) return "widget";
    if (findGameAppEntryByAppId(client, appId)) return "game";
    return undefined;
}

/** Where an added app came from, for the confirmation: the name of its room. */
function originRoomName(client: MatrixClient, roomId: string, savedName: string | undefined): string {
    return client.getRoom(roomId)?.name || savedName || "its room";
}

/** The confirmation's text for removing `appId`, or undefined if it isn't an added app. */
export function removeFromAppsDescription(client: MatrixClient, appId: string, appName: string): string | undefined {
    const widget = findWidgetAppEntryByAppId(client, appId);
    if (widget) {
        const room = originRoomName(client, widget.room_id, widget.room_name);
        return (
            `"${appName}" will still be available in ${room}'s extensions, ` +
            "so you can add it to your apps again from there."
        );
    }
    const game = findGameAppEntryByAppId(client, appId);
    if (game) {
        const room = originRoomName(client, game.room_id, game.room_name);
        return (
            `"${appName}" will still be available in the message it was shared in, in ${room}, ` +
            "so you can add it to your apps again from there."
        );
    }
    return undefined;
}

async function removeApp(client: MatrixClient, appId: string): Promise<void> {
    const widget = findWidgetAppEntryByAppId(client, appId);
    if (widget) return removeWidgetApp(client, widget.room_id, widget.widget_id);
    const game = findGameAppEntryByAppId(client, appId);
    if (game) return removeGameApp(client, game.room_id, game.event_id);
}

/**
 * Asks the user to confirm removing an added app, then removes it. Resolves to whether it was
 * removed. Shows an error dialog itself if removing it fails.
 */
export async function confirmRemoveFromApps(client: MatrixClient, appId: string, appName: string): Promise<boolean> {
    const description = removeFromAppsDescription(client, appId, appName);
    if (!description) return false;
    const { finished } = Modal.createDialog(QuestionDialog, {
        title: `Remove ${appName} from Apps?`,
        description,
        button: "Remove",
        danger: true,
    });
    const [confirmed] = await finished;
    if (!confirmed) return false;
    try {
        await removeApp(client, appId);
        return true;
    } catch (e) {
        logger.error("Couldn't remove an app from Apps", e);
        Modal.createDialog(ErrorDialog, {
            title: "Couldn't remove it from Apps",
            description: "Check your connection and try again.",
        });
        return false;
    }
}

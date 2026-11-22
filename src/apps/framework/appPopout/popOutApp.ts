/*
 * Haven apps framework - pops an app out into its own window, from its button or its menu.
 *
 * Built-in apps that can (HavenApp.canPopOut, such as Social) are drawn into the window by the main
 * window (AppPopoutStore.ts). A room widget added to the user's apps pops out the way a room's
 * widget does (widgetApps/popOutWidgetApp.ts), and a game added from its message the way its card
 * does (gameApps/popOutGameApp.ts).
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import Modal from "../../../../element-web/apps/web/src/Modal";
import ErrorDialog from "../../../../element-web/apps/web/src/components/views/dialogs/ErrorDialog";
import { type HavenApp } from "../types";
import { findWidgetAppEntryByAppId } from "../widgetApps/widgetApps";
import { popOutWidgetApp } from "../widgetApps/popOutWidgetApp";
import { findGameAppEntryByAppId } from "../gameApps/gameApps";
import { popOutGameApp } from "../gameApps/popOutGameApp";
import { AppPopoutStore } from "./AppPopoutStore";

/** Whether the app can pop out into its own window. */
export function canPopOutApp(client: MatrixClient, app: HavenApp): boolean {
    return !!app.canPopOut || !!findWidgetAppEntryByAppId(client, app.id) || !!findGameAppEntryByAppId(client, app.id);
}

/** Pops the app out. Must be called from a click, or popup blockers refuse the window. */
export function popOutApp(client: MatrixClient, app: HavenApp): void {
    const widgetEntry = findWidgetAppEntryByAppId(client, app.id);
    if (widgetEntry) {
        popOutWidgetApp(client, widgetEntry);
        return;
    }
    const gameEntry = findGameAppEntryByAppId(client, app.id);
    if (gameEntry) {
        popOutGameApp(client, gameEntry);
        return;
    }
    if (!app.canPopOut) return;
    void AppPopoutStore.instance.popOut(app.id, window.outerWidth * 0.8, window.outerHeight * 0.85).then((result) => {
        if (result.ok) return;
        Modal.createDialog(ErrorDialog, {
            title: `Couldn't pop out ${app.name}`,
            description: result.reason,
        });
    });
}

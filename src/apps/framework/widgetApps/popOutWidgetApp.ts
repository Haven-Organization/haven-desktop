/*
 * Haven apps framework - pops a widget app out into its own window from outside its page, such as
 * its right-click menu in the space bar.
 *
 * The same pop-out as the button on a room's widget or a widget app's page (WidgetPopoutStore.ts):
 * the window stays connected to the client while the user goes to other apps and rooms. Their
 * buttons pop out the widget the tile on screen is running; this builds what the tile would.
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { ElementWidget, WidgetMessaging } from "../../../../element-web/apps/web/src/stores/widgets/WidgetMessaging";
import { iframeFeatures, sandboxFlags } from "../../../../element-web/apps/web/src/components/views/elements/AppTile";
import WidgetUtils from "../../../../element-web/apps/web/src/utils/WidgetUtils";
import { WidgetType } from "../../../../element-web/apps/web/src/widgets/WidgetType";
import defaultDispatcher from "../../../../element-web/apps/web/src/dispatcher/dispatcher";
import { WidgetPopoutStore } from "../widgetPopout/WidgetPopoutStore";
import { showPopoutRefusedDialog } from "../widgetPopout/WidgetPoppedOut";
import { getWidgetAppStatus } from "./widgetAppStatus";
import { isWidgetEventAllowed } from "./widgetConsent";
import { widgetAppHomeAction, type WidgetAppEntry } from "./widgetApps";

const DEFAULT_WIDTH = 900;
const DEFAULT_HEIGHT = 700;

/**
 * Pops the widget out. Must be called from a click, or popup blockers refuse the window. When
 * it can't pop out here - the widget is gone, or still needs the user's permission to load - the
 * app's page opens instead, which says why or asks.
 */
export function popOutWidgetApp(client: MatrixClient, entry: WidgetAppEntry): void {
    const openPage = (): void =>
        defaultDispatcher.dispatch({ action: widgetAppHomeAction(entry.room_id, entry.widget_id) });

    const status = getWidgetAppStatus(client, entry.room_id, entry.widget_id);
    if (status.kind !== "available") return openPage();
    const { room, app } = status;
    const userId = client.getSafeUserId();
    const allowed = app.creatorUserId === userId || (!!app.eventId && isWidgetEventAllowed(room.roomId, app.eventId));
    if (!allowed || WidgetType.JITSI.matches(app.type)) return openPage();

    const widget = new ElementWidget(app);
    const options = {
        app,
        room,
        userId,
        creatorUserId: app.creatorUserId,
        waitForIframeLoad: app.waitForIframeLoad ?? true,
        userWidget: false,
    };
    const opened = WidgetPopoutStore.instance.popOut({
        uid: WidgetUtils.getWidgetUid(app),
        title: WidgetUtils.getWidgetName(app),
        src: new WidgetMessaging(widget, options).embedUrl,
        allow: iframeFeatures,
        sandbox: sandboxFlags,
        background: getComputedStyle(document.body).backgroundColor,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
        createMessaging: () => new WidgetMessaging(widget, options),
        onFailed: showPopoutRefusedDialog,
    });
    if (!opened) showPopoutRefusedDialog();
}

/*
 * Haven - widget pop-out window protocol
 *
 * A popped-out widget runs in its own window (widget_popout.html, see popoutPage.ts), but its
 * widget API connection stays with Haven's main window (WidgetPopoutStore.ts). The two windows are
 * same-origin and talk with postMessage using the messages below, all under one key so nothing
 * else listening for messages mistakes them for its own.
 *
 * The widget's own messages are relayed as they are: the pop-out window forwards what the widget
 * sends ("in"), and sends the widget what Haven's main window hands it ("out"), so to the widget
 * the pop-out window is the parent it talks to, the same as Haven is when it's embedded.
 */

export const POPOUT_MESSAGE_KEY = "havenWidgetPopout";

/** The pop-out page's file name, next to index.html. */
export const POPOUT_PAGE = "widget_popout.html";

/** Window names start with this, which also tells the desktop app it's a pop-out window. */
export const POPOUT_WINDOW_NAME_PREFIX = "haven_widget_popout_";

/** What the pop-out window needs to show the widget. */
export interface PopoutLoad {
    src: string;
    title: string;
    allow: string;
    sandbox: string;
    background: string;
}

/** Pop-out window → main window. */
export type FromPopout =
    | { [POPOUT_MESSAGE_KEY]: "ready" }
    | { [POPOUT_MESSAGE_KEY]: "frameLoad" }
    | { [POPOUT_MESSAGE_KEY]: "in"; data: unknown }
    | { [POPOUT_MESSAGE_KEY]: "closing" };

/** Main window → pop-out window. */
export type ToPopout =
    | ({ [POPOUT_MESSAGE_KEY]: "load" } & PopoutLoad)
    | { [POPOUT_MESSAGE_KEY]: "out"; data: unknown; targetOrigin: string };

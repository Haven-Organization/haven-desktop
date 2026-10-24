/*
 * Haven - widget pop-out page
 *
 * The script of widget_popout.html, the window a widget pops out into. It holds the widget's
 * iframe and relays messages between the widget and Haven's main window, which keeps running the
 * widget API connection (see protocol.ts and WidgetPopoutStore.ts).
 *
 * Replies to the widget are posted from this window, so the widget sees them come from its own
 * parent, as it would embedded in Haven. Some widgets check that.
 */

import { POPOUT_MESSAGE_KEY, type FromPopout, type ToPopout } from "./protocol";

export function runPopoutPage(win: Window): void {
    const doc = win.document;
    const opener: Window | null = win.opener;
    let frame: HTMLIFrameElement | null = null;

    const toOpener = (message: FromPopout): void => {
        if (opener && !opener.closed) opener.postMessage(message, win.location.origin);
    };

    if (!opener) {
        doc.body.textContent = "Widgets open in this window from Haven.";
        return;
    }

    win.addEventListener("message", (ev: MessageEvent) => {
        if (frame && ev.source === frame.contentWindow) {
            toOpener({ [POPOUT_MESSAGE_KEY]: "in", data: ev.data });
            return;
        }
        // Only Haven's own main window drives this page.
        if (ev.source !== opener || ev.origin !== win.location.origin) return;
        const message = ev.data as ToPopout | undefined;
        switch (message?.[POPOUT_MESSAGE_KEY]) {
            case "load": {
                if (frame) return;
                const { src, title, allow, sandbox, background } = message as Extract<
                    ToPopout,
                    { [POPOUT_MESSAGE_KEY]: "load" }
                >;
                doc.title = title;
                doc.body.style.background = background;
                frame = doc.createElement("iframe");
                frame.title = title;
                frame.allow = allow;
                frame.setAttribute("sandbox", sandbox);
                frame.allowFullscreen = true;
                frame.addEventListener("load", () => toOpener({ [POPOUT_MESSAGE_KEY]: "frameLoad" }));
                frame.src = src;
                doc.body.appendChild(frame);
                return;
            }
            case "out": {
                const { data, targetOrigin } = message as Extract<ToPopout, { [POPOUT_MESSAGE_KEY]: "out" }>;
                frame?.contentWindow?.postMessage(data, targetOrigin);
                return;
            }
        }
    });

    win.addEventListener("pagehide", () => toOpener({ [POPOUT_MESSAGE_KEY]: "closing" }));
    toOpener({ [POPOUT_MESSAGE_KEY]: "ready" });
}

/*
 * Haven - an app popped out into its own window
 *
 * Unlike a widget's pop-out (widgetPopout/), nothing runs in the pop-out window: Haven's main
 * window draws the app into it with a React portal (AppPopoutHost.tsx). The app keeps using the
 * main window's Matrix client, sync and stores, so popping out adds no second client and no
 * second sync, and the app doesn't reload. The pop-out page (app_popout.html) only gets the main
 * window's stylesheets, kept in step so theme changes reach it too.
 *
 * Menus the app opens go into its window through PortalWindowContext.
 */

import { logger } from "matrix-js-sdk/src/logger";

import Modal from "../../../../element-web/apps/web/src/Modal";
import { setDialogWindowResolver } from "./dialogWindow";

export const APP_POPOUT_PAGE = "app_popout.html";
export const APP_POPOUT_WINDOW_NAME_PREFIX = "haven_app_popout_";

/** How long the pop-out page has to load before the attempt counts as failed. */
const LOAD_TIMEOUT_MS = 10000;
const LOAD_POLL_MS = 50;
const CLOSED_POLL_MS = 500;

export interface AppPopout {
    appId: string;
    popup: Window;
    /** Where the app is drawn, in the pop-out's document. */
    container: HTMLElement;
}

export type PopOutResult = { ok: true } | { ok: false; reason: string };

/** Copies the main window's stylesheets and theme classes into the pop-out, and keeps them in step. */
function mirrorStyles(main: Document, target: Document): () => void {
    let copies: Node[] = [];
    const copyAll = (): void => {
        for (const node of copies) node.parentNode?.removeChild(node);
        copies = [];
        for (const node of main.head.querySelectorAll('link[rel="stylesheet"], style')) {
            const copy = target.importNode(node, true);
            target.head.appendChild(copy);
            copies.push(copy);
        }
        target.documentElement.className = main.documentElement.className;
        target.documentElement.style.cssText = main.documentElement.style.cssText;
        target.body.className = main.body.className;
    };
    copyAll();
    // Element switches themes by enabling and disabling its <link>s and changing <html>'s classes.
    let scheduled = false;
    const observer = new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
            scheduled = false;
            copyAll();
        });
    });
    observer.observe(main.head, { childList: true, subtree: true, attributes: true, characterData: true });
    observer.observe(main.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    observer.observe(main.body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
}

export class AppPopoutStore {
    private static internalInstance?: AppPopoutStore;

    public static get instance(): AppPopoutStore {
        AppPopoutStore.internalInstance ??= new AppPopoutStore(window);
        return AppPopoutStore.internalInstance;
    }

    private current: AppPopout | null = null;
    private opening: string | null = null;
    private cleanups: Array<() => void> = [];
    private readonly listeners = new Set<() => void>();

    public constructor(private readonly win: Window) {
        win.addEventListener("pagehide", () => this.popIn());
        // Dialogs open in the pop-out while it has focus, as it does when the user clicked in it.
        setDialogWindowResolver(() => {
            const popup = this.current?.popup;
            return popup && !popup.closed && popup.document.hasFocus() ? popup : null;
        });
    }

    public get popout(): AppPopout | null {
        return this.current;
    }

    public isPoppedOut(appId: string): boolean {
        return this.current?.appId === appId;
    }

    public subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    public getSnapshot = (): AppPopout | null => this.current;

    /** Pops the app out. Must be called from a click, or popup blockers refuse the window. */
    public popOut(appId: string, width: number, height: number): Promise<PopOutResult> {
        if (this.current?.appId === appId) {
            this.current.popup.focus();
            return Promise.resolve({ ok: true });
        }
        if (this.opening) return Promise.resolve({ ok: false, reason: "Already opening a window." });
        this.popIn();

        const url = new URL(APP_POPOUT_PAGE, this.win.location.href).toString();
        let popup: Window | null = null;
        try {
            popup = this.win.open(
                url,
                APP_POPOUT_WINDOW_NAME_PREFIX + appId,
                `popup=yes,width=${Math.round(width)},height=${Math.round(height)}`,
            );
        } catch (e) {
            logger.warn("App pop-out window was refused", e);
        }
        if (!popup) return Promise.resolve({ ok: false, reason: "The window was refused (a popup blocker?)." });

        const opened = popup;
        this.opening = appId;
        const started = Date.now();
        return new Promise<PopOutResult>((resolve) => {
            const finish = (result: PopOutResult): void => {
                this.opening = null;
                resolve(result);
            };
            const poll = (): void => {
                if (opened.closed) return finish({ ok: false, reason: "The window closed before it loaded." });
                let doc: Document | null = null;
                let error: unknown = null;
                try {
                    // Throws when the main window can't reach into the pop-out: a different origin,
                    // or a desktop app that put the window somewhere this one can't script.
                    if (
                        opened.location.pathname.endsWith(APP_POPOUT_PAGE) &&
                        opened.document.readyState === "complete"
                    ) {
                        doc = opened.document;
                    }
                } catch (e) {
                    error = e;
                }
                if (doc) {
                    this.attach(appId, opened, doc);
                    return finish({ ok: true });
                }
                if (Date.now() - started > LOAD_TIMEOUT_MS) {
                    if (!opened.closed) opened.close();
                    return finish({
                        ok: false,
                        reason: error
                            ? `Haven couldn't reach into the window: ${String(error)}`
                            : "The window's page never finished loading.",
                    });
                }
                this.win.setTimeout(poll, LOAD_POLL_MS);
            };
            poll();
        });
    }

    public focus(): void {
        this.current?.popup.focus();
    }

    /** Closes the pop-out; the app goes back to the main window. */
    public popIn(): void {
        const current = this.current;
        if (!current) return;
        this.current = null;
        // Dialogs still open there carry on in the main window.
        Modal.havenReturnDialogsFrom(current.popup);
        for (const cleanup of this.cleanups.splice(0)) cleanup();
        if (!current.popup.closed) current.popup.close();
        this.emit();
    }

    private attach(appId: string, popup: Window, doc: Document): void {
        const container = doc.createElement("div");
        container.className = "haven_AppPopout";
        container.style.cssText = "position: fixed; inset: 0; display: flex;";
        doc.body.appendChild(container);
        this.cleanups.push(mirrorStyles(this.win.document, doc));

        const closedPoll = this.win.setInterval(() => {
            if (popup.closed) this.popIn();
        }, CLOSED_POLL_MS);
        this.cleanups.push(() => this.win.clearInterval(closedPoll));
        const onPageHide = (): void => this.popIn();
        popup.addEventListener("pagehide", onPageHide);
        this.cleanups.push(() => popup.removeEventListener("pagehide", onPageHide));

        this.current = { appId, popup, container };
        this.emit();
    }

    private emit(): void {
        for (const listener of [...this.listeners]) listener();
    }
}

/*
 * Haven - draws a popped-out app into its window (see AppPopoutStore.ts).
 *
 * Mounted once by LoggedInView, so the app keeps running in its window whichever page the main
 * window shows. The portal keeps the app inside the main window's React tree, with its Matrix
 * client and stores.
 */

import React, { type JSX, Suspense, useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { logger } from "matrix-js-sdk/src/logger";

import { getApp } from "../registry";
import { UserMenuPortalContext } from "../UserMenuPortalContext";
import { AppPopoutContext } from "./AppPopoutContext";
import { PortalWindowContext } from "./PortalWindowContext";
import { AppPopoutStore } from "./AppPopoutStore";

const noop = (): void => {};

export function AppPopoutHost(): JSX.Element | null {
    const store = AppPopoutStore.instance;
    const popout = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const app = popout ? getApp(popout.appId) : undefined;

    useEffect(() => {
        if (popout && app) popout.popup.document.title = app.name;
    }, [popout, app]);

    useEffect(() => {
        if (popout && !app) {
            logger.warn(`No app ${popout.appId} to show in its pop-out window`);
            store.popIn();
        }
    }, [popout, app, store]);

    if (!popout || !app) return null;
    return createPortal(
        <AppPopoutContext.Provider value={true}>
            <PortalWindowContext.Provider value={popout.popup}>
                {/* The main window's user menu stays in the main window. */}
                <UserMenuPortalContext.Provider value={noop}>
                    <Suspense fallback={null}>
                        <app.Component />
                    </Suspense>
                </UserMenuPortalContext.Provider>
            </PortalWindowContext.Provider>
        </AppPopoutContext.Provider>,
        popout.container,
    );
}

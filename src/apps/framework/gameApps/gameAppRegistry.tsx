/*
 * Haven apps framework - game apps as HavenApps
 *
 * Turns the user's game apps (gameApps.ts) into HavenApp definitions, as widgetAppRegistry.tsx
 * does for widgets. Each game app keeps one Component for as long as it exists: a new component
 * type on every lookup would remount the game, restarting it, on any render.
 */

import React, { lazy, type ComponentType, type JSX } from "react";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { type HavenApp } from "../types";
import { gameAppHomeAction, gameAppId, getGameAppEntries, type GameAppEntry } from "./gameApps";
import { GameControllerIcon } from "./GameControllerIcon";

// Lazy for the same reason as Social's view (see social/app.ts): this file is imported at boot by
// the registry, and the view pulls in the game player.
const LazyGameAppView = lazy(() => import("./GameAppView").then((m) => ({ default: m.GameAppView })));

const components = new Map<string, ComponentType<Record<string, never>>>();
const apps = new Map<string, HavenApp>();

function componentFor(entry: GameAppEntry): ComponentType<Record<string, never>> {
    const id = gameAppId(entry.room_id, entry.event_id);
    let component = components.get(id);
    if (!component) {
        const { room_id: roomId, event_id: eventId } = entry;
        const GameAppPage = (): JSX.Element => <LazyGameAppView roomId={roomId} eventId={eventId} />;
        component = GameAppPage;
        components.set(id, component);
    }
    return component;
}

function appFor(entry: GameAppEntry): HavenApp {
    const id = gameAppId(entry.room_id, entry.event_id);
    const cached = apps.get(id);
    if (cached && cached.name === entry.name && cached.image === entry.icon) return cached;

    const app: HavenApp = {
        id,
        name: entry.name,
        Icon: GameControllerIcon,
        image: entry.icon,
        homeAction: gameAppHomeAction(entry.room_id, entry.event_id),
        Component: componentFor(entry),
    };
    apps.set(id, app);
    return app;
}

/** The user's game apps, in the order they added them. */
export function getGameApps(client: MatrixClient | null | undefined): HavenApp[] {
    if (!client) return [];
    return getGameAppEntries(client).map(appFor);
}

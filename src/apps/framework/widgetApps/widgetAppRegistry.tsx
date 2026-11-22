/*
 * Haven apps framework - widget apps as HavenApps
 *
 * Turns the user's widget apps (widgetApps.ts) into HavenApp definitions, so the space bar, the
 * apps picker and MatrixChat's page switching treat them like built-in apps. The definitions are
 * cached by app id, and each widget app keeps one Component for as long as it exists: a new
 * component type on every lookup would remount the widget (and reload its iframe) on any render.
 */

import React, { lazy, type ComponentType, type JSX } from "react";
import { ExtensionsIcon } from "@vector-im/compound-design-tokens/assets/web/icons";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { mediaFromMxc } from "../../../../element-web/apps/web/src/customisations/Media";
import { type HavenApp } from "../types";
import { getWidgetAppEntries, widgetAppHomeAction, widgetAppId, type WidgetAppEntry } from "./widgetApps";

// Lazy for the same reason as Social's view (see social/app.ts): this file is imported at boot by
// the registry, and the view pulls in AppTile and the widget stores.
const LazyWidgetAppView = lazy(() => import("./WidgetAppView").then((m) => ({ default: m.WidgetAppView })));

const components = new Map<string, ComponentType<Record<string, never>>>();
const apps = new Map<string, HavenApp>();

function componentFor(entry: WidgetAppEntry): ComponentType<Record<string, never>> {
    const id = widgetAppId(entry.room_id, entry.widget_id);
    let component = components.get(id);
    if (!component) {
        const { room_id: roomId, widget_id: widgetId } = entry;
        const WidgetAppPage = (): JSX.Element => <LazyWidgetAppView roomId={roomId} widgetId={widgetId} />;
        component = WidgetAppPage;
        components.set(id, component);
    }
    return component;
}

/** The widget's name for the apps list: its own, else its title, else a generic one. */
export function widgetAppName(entry: WidgetAppEntry): string {
    const { name, data } = entry.content as { name?: unknown; data?: { title?: unknown } };
    if (typeof name === "string" && name.trim()) return name.trim();
    if (typeof data?.title === "string" && data.title.trim()) return data.title.trim();
    return "Widget";
}

function imageFor(client: MatrixClient, entry: WidgetAppEntry): string | undefined {
    const avatar = entry.content.avatar_url;
    if (typeof avatar !== "string" || !avatar.startsWith("mxc://")) return undefined;
    return mediaFromMxc(avatar, client).getSquareThumbnailHttp(64) ?? undefined;
}

function appFor(client: MatrixClient, entry: WidgetAppEntry): HavenApp {
    const id = widgetAppId(entry.room_id, entry.widget_id);
    const name = widgetAppName(entry);
    const image = imageFor(client, entry);
    const cached = apps.get(id);
    if (cached && cached.name === name && cached.image === image) return cached;

    const app: HavenApp = {
        id,
        name,
        Icon: ExtensionsIcon,
        image,
        homeAction: widgetAppHomeAction(entry.room_id, entry.widget_id),
        Component: componentFor(entry),
    };
    apps.set(id, app);
    return app;
}

/** The user's widget apps, in the order they added them. */
export function getWidgetApps(client: MatrixClient | null | undefined): HavenApp[] {
    if (!client) return [];
    return getWidgetAppEntries(client).map((entry) => appFor(client, entry));
}

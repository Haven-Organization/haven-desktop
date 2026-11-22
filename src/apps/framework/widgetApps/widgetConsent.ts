/*
 * Haven apps framework - widget load permission for widget apps
 *
 * Element asks before loading a widget someone else added to a room, and remembers the answer per
 * widget state event, in the "allowedWidgets" setting (see AppTile.tsx). Adding a widget to your
 * apps is already saying yes, so it's recorded the same way. A bridge that rewrites its widget
 * makes a new state event, which Element would ask about again; widgetAppConsentCarriesOver says
 * when the user's yes still applies.
 */

import SettingsStore from "../../../../element-web/apps/web/src/settings/SettingsStore";
import { type WidgetAppEntry } from "./widgetApps";

export function isWidgetEventAllowed(roomId: string, eventId: string): boolean {
    return !!SettingsStore.getValue("allowedWidgets", roomId)?.[eventId];
}

/** Records that the user allows this widget state event to load, as AppTile's own prompt does. */
export async function allowWidgetEvent(roomId: string, eventId: string): Promise<void> {
    if (isWidgetEventAllowed(roomId, eventId)) return;
    const current = { ...(SettingsStore.getValue("allowedWidgets", roomId) ?? {}), [eventId]: true };
    const level = SettingsStore.firstSupportedLevel("allowedWidgets");
    if (!level) return;
    await SettingsStore.setValue("allowedWidgets", roomId, level, current);
}

function originOf(url: unknown): string | null {
    if (typeof url !== "string") return null;
    try {
        return new URL(url).origin;
    } catch {
        return null;
    }
}

/**
 * Whether the user's earlier yes covers the widget as the room has it now: the same account set
 * it, and it still loads from the same site. Anything else asks again, as Element would.
 */
export function widgetAppConsentCarriesOver(entry: WidgetAppEntry, current: WidgetAppEntry): boolean {
    const origin = originOf(entry.content.url);
    return !!origin && current.sender === entry.sender && originOf(current.content.url) === origin;
}

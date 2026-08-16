/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import SettingsStore from "../SettingsStore";
import type IWatcher from "./Watcher";

/**
 * Haven: pushes the "Haven.roomListBackdropOpacity" setting out to a CSS custom property so
 * BackdropPanel's blurred-avatar background (behind the room list, spaces bar, and Social sidebar -
 * see BackdropPanel.tsx) can read it from plain CSS `color-mix()` rules without every consumer
 * having to watch the setting itself. See _LeftPanel.pcss/_SpacePanel.pcss/social-overlay.scss for
 * the consuming `color-mix(in srgb, var(--cpd-color-bg-canvas-default)
 * var(--haven-roomlist-blur-opacity, 90%), transparent)` rules.
 */
export class RoomListBackdropWatcher implements IWatcher {
    public static readonly CSS_CUSTOM_PROPERTY = "--haven-roomlist-blur-opacity";

    private watcherRef?: string;

    public start(): void {
        this.updateOpacity();
        this.watcherRef = SettingsStore.watchSetting("Haven.roomListBackdropOpacity", null, this.updateOpacity);
    }

    public stop(): void {
        SettingsStore.unwatchSetting(this.watcherRef);
    }

    private updateOpacity = (): void => {
        const opacity = SettingsStore.getValue("Haven.roomListBackdropOpacity");
        document
            .querySelector<HTMLElement>(":root")!
            .style.setProperty(RoomListBackdropWatcher.CSS_CUSTOM_PROPERTY, `${opacity}%`);
    };
}

/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

// @vitest-environment happy-dom

import { describe, it, expect, vi, afterEach } from "vitest";

import SettingsStore from "../SettingsStore";
import { RoomListBackdropWatcher } from "./RoomListBackdropWatcher";

// Haven: regression coverage for pushing "Haven.roomListBackdropOpacity" out to a CSS custom
// property that BackdropPanel's blurred-avatar background reads via plain CSS color-mix() rules.
describe("RoomListBackdropWatcher", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        document.documentElement.style.removeProperty(RoomListBackdropWatcher.CSS_CUSTOM_PROPERTY);
    });

    it("sets the CSS custom property from the setting's current value on start()", () => {
        vi.spyOn(SettingsStore, "getValue").mockReturnValue(42 as any);
        vi.spyOn(SettingsStore, "watchSetting").mockReturnValue("watcher-ref");

        const watcher = new RoomListBackdropWatcher();
        watcher.start();

        expect(document.documentElement.style.getPropertyValue(RoomListBackdropWatcher.CSS_CUSTOM_PROPERTY)).toBe(
            "42%",
        );
    });

    it("registers a watcher for the setting and updates the property again when it changes", () => {
        let currentValue = 10;
        vi.spyOn(SettingsStore, "getValue").mockImplementation(() => currentValue as any);
        let watchCallback: (() => void) | undefined;
        vi.spyOn(SettingsStore, "watchSetting").mockImplementation((_name, _roomId, cb) => {
            watchCallback = cb as unknown as () => void;
            return "watcher-ref";
        });

        const watcher = new RoomListBackdropWatcher();
        watcher.start();
        expect(document.documentElement.style.getPropertyValue(RoomListBackdropWatcher.CSS_CUSTOM_PROPERTY)).toBe(
            "10%",
        );

        currentValue = 75;
        watchCallback?.();

        expect(document.documentElement.style.getPropertyValue(RoomListBackdropWatcher.CSS_CUSTOM_PROPERTY)).toBe(
            "75%",
        );
    });

    it("unwatches the setting on stop()", () => {
        vi.spyOn(SettingsStore, "getValue").mockReturnValue(50 as any);
        vi.spyOn(SettingsStore, "watchSetting").mockReturnValue("watcher-ref-123");
        const unwatchSpy = vi.spyOn(SettingsStore, "unwatchSetting").mockImplementation(() => {});

        const watcher = new RoomListBackdropWatcher();
        watcher.start();
        watcher.stop();

        expect(unwatchSpy).toHaveBeenCalledWith("watcher-ref-123");
    });
});

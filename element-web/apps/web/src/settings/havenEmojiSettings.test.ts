/*
 * Copyright 2026 Haven
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

// @vitest-environment happy-dom

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { EMOJI_SKIN_TONES } from "@element-hq/web-shared-components";

import SettingsStore from "./SettingsStore";
import { SETTINGS } from "./Settings";
import { SettingLevel } from "./SettingLevel";
import { GunEmojiStyle } from "./enums/GunEmojiStyle";
import SystemFontController from "./controllers/SystemFontController";
import { _t } from "../languageHandler";

// Haven: guards the two emoji preference settings and the stylesheet hookup for their settings UI.
// Settings.tsx and res/css/_components.pcss are upstream-owned files that an upstream merge rewrites
// around Haven's additions, so this checks the additions themselves rather than trusting the merge.

// (import.meta.dirname rather than new URL(..., import.meta.url): under happy-dom the latter isn't a file: URL.)
const CSS_ROOT = resolve(import.meta.dirname, "../../res/css") + "/";

describe("Haven.gunEmojiStyle setting", () => {
    const setting = SETTINGS["Haven.gunEmojiStyle"];

    it("is defined, defaulting to the handgun", () => {
        expect(setting).toBeDefined();
        expect(setting.default).toBe(GunEmojiStyle.Handgun);
    });

    it("is stored per device, like the bundled emoji font setting it depends on", () => {
        expect(setting.supportedLevels).toEqual([SettingLevel.DEVICE]);
        expect(SETTINGS["useBundledEmojiFont"].supportedLevels).toEqual(setting.supportedLevels);
    });

    it("re-applies the font stack when it changes (same controller as the system font settings)", () => {
        expect(setting.controller).toBeInstanceOf(SystemFontController);
    });

    it("offers exactly the revolver, the handgun and the water pistol", () => {
        expect(Object.values(GunEmojiStyle).sort()).toEqual(["handgun", "revolver", "water-pistol"]);
    });

    it("round-trips through the settings store", async () => {
        await SettingsStore.setValue("Haven.gunEmojiStyle", null, SettingLevel.DEVICE, GunEmojiStyle.Revolver);
        expect(SettingsStore.getValue("Haven.gunEmojiStyle")).toBe(GunEmojiStyle.Revolver);
        await SettingsStore.setValue("Haven.gunEmojiStyle", null, SettingLevel.DEVICE, GunEmojiStyle.Handgun);
        expect(SettingsStore.getValue("Haven.gunEmojiStyle")).toBe(GunEmojiStyle.Handgun);
    });
});

describe("Haven.emojiSkinTone setting", () => {
    const setting = SETTINGS["Haven.emojiSkinTone"];

    it("is defined, defaulting to no skin tone", () => {
        expect(setting).toBeDefined();
        expect(setting.default).toBe("none");
        expect(EMOJI_SKIN_TONES).toContain(setting.default);
    });

    it("follows the account, so the choice carries over to other devices", () => {
        expect(setting.supportedLevels).toContain(SettingLevel.ACCOUNT);
    });

    it("has the default plus the five standard tones to choose from", () => {
        expect([...EMOJI_SKIN_TONES]).toEqual(["none", "light", "medium-light", "medium", "medium-dark", "dark"]);
    });
});

describe("emoji preference strings", () => {
    const keys = [
        "settings|emoji_stickers|gun_emoji_style",
        "settings|emoji_stickers|gun_emoji_style_description",
        "settings|emoji_stickers|gun_emoji_style_revolver",
        "settings|emoji_stickers|gun_emoji_style_handgun",
        "settings|emoji_stickers|gun_emoji_style_water_pistol",
        "settings|emoji_stickers|emoji_skin_tone",
        "settings|emoji_stickers|emoji_skin_tone_description",
        "settings|emoji_stickers|emoji_skin_tone_none",
        "settings|emoji_stickers|emoji_skin_tone_light",
        "settings|emoji_stickers|emoji_skin_tone_medium_light",
        "settings|emoji_stickers|emoji_skin_tone_medium",
        "settings|emoji_stickers|emoji_skin_tone_medium_dark",
        "settings|emoji_stickers|emoji_skin_tone_dark",
    ];

    it.each(keys)("%s resolves to real text", (key) => {
        // An unknown key is returned as-is, so a string that survived a merge shows up as different text.
        expect(_t(key as Parameters<typeof _t>[0])).not.toBe(key);
    });

    it("the gun description says what it does and doesn't do", () => {
        const description = _t("settings|emoji_stickers|gun_emoji_style_description");
        expect(description).toContain("doesn't change what other people see");
        expect(description).toContain("Use bundled emoji font");
    });
});

describe("Haven-authored stylesheets are pulled in by res/css/_components.pcss", () => {
    function pcssFiles(dir: string): string[] {
        return readdirSync(dir).flatMap((name) => {
            const path = join(dir, name);
            return statSync(path).isDirectory() ? pcssFiles(path) : name.endsWith(".pcss") ? [path] : [];
        });
    }

    // Files carrying Haven's own copyright header (upstream-owned files only ever get "Haven:" comments).
    const havenFiles = pcssFiles(CSS_ROOT).filter((file) => /Copyright 20\d\d Haven/.test(readFileSync(file, "utf8")));
    const index = readFileSync(join(CSS_ROOT, "_components.pcss"), "utf8");

    it("finds the known Haven stylesheets", () => {
        const names = havenFiles.map((file) => file.slice(CSS_ROOT.length));
        expect(names).toEqual(
            expect.arrayContaining([
                "views/rooms/_ReactionPillSize.pcss",
                "views/settings/_EmojiPreferenceDropdown.pcss",
                "views/settings/_ReactionPillSizeSwitcher.pcss",
            ]),
        );
    });

    it.each(havenFiles.map((file) => file.slice(CSS_ROOT.length)))("%s is imported", (name) => {
        expect(index).toContain(`@import "./${name}";`);
    });
});

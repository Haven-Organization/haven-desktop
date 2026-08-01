// Haven: regression coverage for the customizable-keyboard-shortcuts feature (see this module's
// own doc) - specifically guards against an upstream element-web merge silently reverting the
// resolveShortcut/getBindingsByCategory wiring these functions depend on external callers using
// correctly, by pinning down the exact contract those callers (KeyBindingsDefaults.ts,
// KeyboardShortcutUtils.ts) rely on.
import { describe, it, expect, vi, beforeEach } from "vitest";

import SettingsStore from "../../../element-web/apps/web/src/settings/SettingsStore";
import { SettingLevel } from "../../../element-web/apps/web/src/settings/SettingLevel";
import {
    getCustomShortcuts,
    resolveShortcut,
    setCustomShortcut,
    resetAllCustomShortcuts,
    comboFromKeyboardEvent,
    validateCustomCombo,
    RESERVED_KEYS,
} from "./customKeyboardShortcuts";

describe("customKeyboardShortcuts", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    describe("getCustomShortcuts", () => {
        it("returns an empty object when nothing has been saved yet", () => {
            vi.spyOn(SettingsStore, "getValue").mockReturnValue(undefined as never);
            expect(getCustomShortcuts()).toEqual({});
        });

        it("returns the saved overrides verbatim", () => {
            const saved = { "KeyBinding.showStickerPicker": { key: "j", altKey: true } };
            vi.spyOn(SettingsStore, "getValue").mockReturnValue(saved as never);
            expect(getCustomShortcuts()).toBe(saved);
        });
    });

    describe("resolveShortcut", () => {
        it("falls back to the default when no override is saved for that action", () => {
            vi.spyOn(SettingsStore, "getValue").mockReturnValue({} as never);
            const defaultCombo = { key: ";", ctrlOrCmdKey: true };
            expect(resolveShortcut("KeyBinding.showStickerPicker", defaultCombo)).toBe(defaultCombo);
        });

        it("prefers the user's own override over the default", () => {
            const override = { key: "j", altKey: true };
            vi.spyOn(SettingsStore, "getValue").mockReturnValue({
                "KeyBinding.showStickerPicker": override,
            } as never);
            expect(resolveShortcut("KeyBinding.showStickerPicker", { key: ";", ctrlOrCmdKey: true })).toBe(override);
        });

        it("returns undefined when there's no override and no default", () => {
            vi.spyOn(SettingsStore, "getValue").mockReturnValue({} as never);
            expect(resolveShortcut("KeyBinding.someUnknownAction", undefined)).toBeUndefined();
        });
    });

    describe("setCustomShortcut", () => {
        it("saves the new override at ACCOUNT level, merged alongside any existing ones", async () => {
            vi.spyOn(SettingsStore, "getValue").mockReturnValue({
                "KeyBinding.existingOverride": { key: "k", ctrlKey: true },
            } as never);
            const setValue = vi.spyOn(SettingsStore, "setValue").mockResolvedValue(undefined);

            await setCustomShortcut("KeyBinding.showStickerPicker", { key: "j", altKey: true });

            expect(setValue).toHaveBeenCalledWith("Haven.customKeyboardShortcuts", null, SettingLevel.ACCOUNT, {
                "KeyBinding.existingOverride": { key: "k", ctrlKey: true },
                "KeyBinding.showStickerPicker": { key: "j", altKey: true },
            });
        });

        it("replaces a previous override for the same action rather than duplicating it", async () => {
            vi.spyOn(SettingsStore, "getValue").mockReturnValue({
                "KeyBinding.showStickerPicker": { key: "k", ctrlKey: true },
            } as never);
            const setValue = vi.spyOn(SettingsStore, "setValue").mockResolvedValue(undefined);

            await setCustomShortcut("KeyBinding.showStickerPicker", { key: "j", altKey: true });

            expect(setValue).toHaveBeenCalledWith("Haven.customKeyboardShortcuts", null, SettingLevel.ACCOUNT, {
                "KeyBinding.showStickerPicker": { key: "j", altKey: true },
            });
        });
    });

    describe("resetAllCustomShortcuts", () => {
        it("clears every saved override at once", async () => {
            const setValue = vi.spyOn(SettingsStore, "setValue").mockResolvedValue(undefined);

            await resetAllCustomShortcuts();

            expect(setValue).toHaveBeenCalledWith("Haven.customKeyboardShortcuts", null, SettingLevel.ACCOUNT, {});
        });
    });

    describe("comboFromKeyboardEvent", () => {
        function mkEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
            return {
                key: "j",
                isComposing: false,
                ctrlKey: false,
                altKey: false,
                shiftKey: false,
                metaKey: false,
                ...overrides,
            } as KeyboardEvent;
        }

        it("returns null mid-IME-composition, regardless of what key is reported", () => {
            expect(comboFromKeyboardEvent(mkEvent({ isComposing: true }))).toBeNull();
        });

        it("returns null for an unidentified key", () => {
            expect(comboFromKeyboardEvent(mkEvent({ key: "Unidentified" }))).toBeNull();
        });

        it("returns null for a bare modifier press with nothing to pair it with", () => {
            expect(comboFromKeyboardEvent(mkEvent({ key: "Control" }))).toBeNull();
            expect(comboFromKeyboardEvent(mkEvent({ key: "Alt" }))).toBeNull();
            expect(comboFromKeyboardEvent(mkEvent({ key: "Shift" }))).toBeNull();
            expect(comboFromKeyboardEvent(mkEvent({ key: "Meta" }))).toBeNull();
        });

        it("lower-cases a single-character key so Shift+letter matches Key.A..Key.Z", () => {
            const combo = comboFromKeyboardEvent(mkEvent({ key: "J", shiftKey: true }));
            expect(combo).toEqual({ key: "j", ctrlKey: false, altKey: false, shiftKey: true, metaKey: false });
        });

        it("leaves a multi-character key value untouched", () => {
            const combo = comboFromKeyboardEvent(mkEvent({ key: "ArrowUp", altKey: true }));
            expect(combo).toEqual({ key: "ArrowUp", ctrlKey: false, altKey: true, shiftKey: false, metaKey: false });
        });

        it("captures every modifier as held", () => {
            const combo = comboFromKeyboardEvent(
                mkEvent({ key: "j", ctrlKey: true, altKey: true, shiftKey: true, metaKey: true }),
            );
            expect(combo).toEqual({ key: "j", ctrlKey: true, altKey: true, shiftKey: true, metaKey: true });
        });
    });

    describe("validateCustomCombo", () => {
        it("rejects Enter/Escape/Tab even with a modifier held", () => {
            for (const key of RESERVED_KEYS) {
                expect(validateCustomCombo({ key, ctrlKey: true })).not.toBeNull();
            }
        });

        it("rejects a combo with no Ctrl or Alt held", () => {
            expect(validateCustomCombo({ key: "j", shiftKey: true })).not.toBeNull();
            expect(validateCustomCombo({ key: "j" })).not.toBeNull();
        });

        it("accepts a plain Ctrl combo", () => {
            expect(validateCustomCombo({ key: "j", ctrlKey: true })).toBeNull();
        });

        it("accepts a plain Alt combo", () => {
            expect(validateCustomCombo({ key: "j", altKey: true })).toBeNull();
        });

        it("accepts Ctrl or Alt alongside an extra Shift modifier", () => {
            expect(validateCustomCombo({ key: "j", altKey: true, shiftKey: true })).toBeNull();
        });
    });
});

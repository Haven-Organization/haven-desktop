/*
 * Haven apps framework — customizable keyboard shortcuts
 *
 * Lets a user override select stock keyboard shortcuts with their own key combination, stored as
 * a single account-wide setting (Haven.customKeyboardShortcuts) mapping a KeyBindingAction's
 * string value to the KeyCombo that should be used instead of KEYBOARD_SHORTCUTS[action].default.
 * Deliberately narrow in scope (see KeyboardUserSettingsTab.tsx's own doc for the eligibility
 * rule, and RecordKeyboardShortcutDialog.tsx for the entry-rules below): only shortcuts whose
 * default already uses a modifier and isn't Enter/Escape/Tab can be customized at all, and any
 * replacement must itself use Ctrl or Alt and never be Enter/Escape/Tab either.
 *
 * Deliberately a leaf module with no dependency on KeyboardShortcutUtils.ts/KeyBindingsDefaults.ts
 * (both depend on THIS file instead, one-way) - those two need each other's help resolving a
 * shortcut's effective value from opposite ends (UI display vs. real key-matching), and looping
 * back through here would risk a circular import for no benefit, since none of the logic here
 * actually needs to know how a default is computed - just how to read/write/validate an override
 * given whatever default the caller already resolved.
 */

import { type KeyCombo } from "../../../element-web/apps/web/src/KeyBindingsManager";
import { Key } from "../../../element-web/apps/web/src/Keyboard";
import SettingsStore from "../../../element-web/apps/web/src/settings/SettingsStore";
import { SettingLevel } from "../../../element-web/apps/web/src/settings/SettingLevel";

/** Keyed by KeyBindingAction's own string value - kept as a plain `string` here rather than
 *  importing the KeyBindingAction enum itself, which would create a circular import (Settings.tsx
 *  needs this setting's own value type, but KeyboardShortcuts.ts - where KeyBindingAction lives -
 *  already imports IBaseSetting FROM Settings.tsx). Every real caller passes a genuine
 *  KeyBindingAction value in and gets one back out; only the stored type itself is loosened. */
export type CustomKeyboardShortcuts = Record<string, KeyCombo>;

/** Enter/Escape/Tab - never a valid key for a custom combo, and what makes a shortcut whose
 *  DEFAULT already uses one of these ineligible for customization at all in the first place (see
 *  KeyboardShortcutUtils.ts's own isShortcutCustomizable). */
export const RESERVED_KEYS: ReadonlySet<string> = new Set([Key.ENTER, Key.ESCAPE, Key.TAB]);

/** All of this user's own overrides, keyed by action. Empty object if none set. */
export function getCustomShortcuts(): CustomKeyboardShortcuts {
    return SettingsStore.getValue("Haven.customKeyboardShortcuts") ?? {};
}

/** The combo that should actually be used for `action` - this user's own override if they've set
 *  one, otherwise `defaultCombo` (whatever the caller already resolved as that action's stock
 *  default) unchanged. Shared by both the runtime key-matching path (KeyBindingsDefaults.ts's own
 *  getBindingsByCategory) and the settings UI's own display value
 *  (KeyboardShortcutUtils.ts's own getKeyboardShortcutValue), so a saved override takes effect in
 *  both identically - actually pressing the new combo, and the settings page showing it. */
export function resolveShortcut(action: string, defaultCombo: KeyCombo | undefined): KeyCombo | undefined {
    return getCustomShortcuts()[action] ?? defaultCombo;
}

/** Saves `combo` as this user's own override for `action`, replacing any previous override for
 *  that same action - does not validate; call validateCustomCombo first. */
export async function setCustomShortcut(action: string, combo: KeyCombo): Promise<void> {
    const next: CustomKeyboardShortcuts = { ...getCustomShortcuts(), [action]: combo };
    await SettingsStore.setValue("Haven.customKeyboardShortcuts", null, SettingLevel.ACCOUNT, next);
}

/** Clears every saved override at once - the "Reset to Default" button's own action, confirmed via
 *  its own dialog first (see KeyboardUserSettingsTab.tsx). */
export async function resetAllCustomShortcuts(): Promise<void> {
    await SettingsStore.setValue("Haven.customKeyboardShortcuts", null, SettingLevel.ACCOUNT, {});
}

/** Turns a raw KeyboardEvent into a KeyCombo the same way every existing default is already
 *  shaped (letters lower-cased to match Key.A..Key.Z/isKeyComboMatch's own case-insensitive-
 *  under-shift comparison; every other key's real `.key` value already matches what the defaults
 *  use verbatim, e.g. "ArrowUp", "F6", ";"). Returns null for anything that isn't a real
 *  candidate combo yet at all - a bare modifier press on its own (nothing to pair it with), or
 *  something the browser couldn't identify (mid-IME-composition, an unrecognized key) - this is
 *  the "make sure the keys used are compatible" rule: only a genuine, fully-resolved single key
 *  event is ever turned into a combo to begin with. */
export function comboFromKeyboardEvent(ev: KeyboardEvent): KeyCombo | null {
    if (ev.isComposing || !ev.key || ev.key === "Unidentified") return null;
    if (ev.key === Key.CONTROL || ev.key === Key.ALT || ev.key === Key.SHIFT || ev.key === Key.META) return null;

    return {
        key: ev.key.length === 1 ? ev.key.toLowerCase() : ev.key,
        ctrlKey: ev.ctrlKey,
        altKey: ev.altKey,
        shiftKey: ev.shiftKey,
        metaKey: ev.metaKey,
    };
}

/** The rules a custom combo must satisfy before it can be saved: must include Ctrl or Alt (extra
 *  modifiers like Shift alongside are fine), and the key itself can never be Enter/Escape/Tab
 *  regardless of what else is held. Returns an error message to show the user when invalid, or
 *  null when the combo is good to save. */
export function validateCustomCombo(combo: KeyCombo): string | null {
    if (RESERVED_KEYS.has(combo.key)) {
        return "Enter, Escape, and Tab can't be used in a custom shortcut.";
    }
    if (!combo.ctrlKey && !combo.altKey) {
        return "Custom shortcuts must include Ctrl or Alt.";
    }
    return null;
}

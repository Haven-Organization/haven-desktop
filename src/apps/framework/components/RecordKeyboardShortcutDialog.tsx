/*
 * Haven apps framework — RecordKeyboardShortcutDialog
 *
 * Opened by clicking a customizable row in Settings > Keyboard (see
 * KeyboardUserSettingsTab.tsx/KeyboardShortcutUtils.ts's own isShortcutCustomizable) - lets the
 * user press the key combination they want instead, live-previewed using the exact same
 * KeyboardKey/KeyboardShortcut chips the settings page itself already renders, and enforces the
 * feature's own rules (see customKeyboardShortcuts.ts's own validateCustomCombo) before Save can
 * be clicked: must include Ctrl or Alt, and can never be Enter/Escape/Tab.
 *
 * Escape/the [x]/a click outside all cancel, exactly like every other dialog in this app - not
 * anything bespoke here, just BaseDialog/Modal's own already-standard behavior. Escape
 * specifically is never captured as a candidate key by the recorder below - it's one of the three
 * reserved keys anyway, so there is nothing lost by letting it fall straight through to that
 * default close-the-dialog handling instead.
 */

import React, { type JSX, useEffect, useState } from "react";

import BaseDialog from "../../../../element-web/apps/web/src/components/views/dialogs/BaseDialog";
import DialogButtons from "../../../../element-web/apps/web/src/components/views/elements/DialogButtons";
import {
    KeyboardKey,
    KeyboardShortcut,
} from "../../../../element-web/apps/web/src/components/views/settings/KeyboardShortcut";
import { type KeyCombo } from "../../../../element-web/apps/web/src/KeyBindingsManager";
import { Key } from "../../../../element-web/apps/web/src/Keyboard";
import { comboFromKeyboardEvent, validateCustomCombo } from "../customKeyboardShortcuts";

const MODIFIER_KEYS = new Set([Key.CONTROL, Key.ALT, Key.SHIFT, Key.META]);

interface HeldModifiers {
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
}

const NO_MODIFIERS_HELD: HeldModifiers = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };

export interface RecordKeyboardShortcutDialogProps {
    /** Human-readable label of the action being rebound, e.g. "Toggle bold" - shown in the title. */
    actionDisplayName: string;
    /** The shortcut's current combo (its default, or an earlier custom override), shown for
     *  reference above the recorder so the user can see what they're about to replace. */
    currentValue: KeyCombo | undefined;
    onFinished: (combo?: KeyCombo) => void;
}

export function RecordKeyboardShortcutDialog({
    actionDisplayName,
    currentValue,
    onFinished,
}: RecordKeyboardShortcutDialogProps): JSX.Element {
    const [combo, setCombo] = useState<KeyCombo | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [held, setHeld] = useState<HeldModifiers>(NO_MODIFIERS_HELD);

    useEffect(() => {
        const onKeyDown = (ev: KeyboardEvent): void => {
            // Deliberately does nothing at all here (not even preventDefault) - let this bubble
            // straight up to BaseDialog's own Escape-closes-dialog handling, the same as it would
            // for any other dialog. Escape is also always a reserved key (see RESERVED_KEYS), so
            // there's no candidate combo being lost by never treating it as one.
            if (ev.key === Key.ESCAPE) return;

            ev.preventDefault();
            ev.stopPropagation();

            if (MODIFIER_KEYS.has(ev.key)) {
                setHeld({ ctrlKey: ev.ctrlKey, altKey: ev.altKey, shiftKey: ev.shiftKey, metaKey: ev.metaKey });
                return;
            }

            const candidate = comboFromKeyboardEvent(ev);
            // Nothing usable yet (e.g. still mid-IME-composition) - "make sure the keys used are
            // compatible" - silently wait for a real key rather than showing a confusing error for
            // something the user didn't actually intend as a key press.
            if (!candidate) return;

            setCombo(candidate);
            setError(validateCustomCombo(candidate));
        };

        const onKeyUp = (ev: KeyboardEvent): void => {
            if (MODIFIER_KEYS.has(ev.key)) {
                setHeld({ ctrlKey: ev.ctrlKey, altKey: ev.altKey, shiftKey: ev.shiftKey, metaKey: ev.metaKey });
            }
        };

        // Capture phase + stopPropagation (except Escape, see above) - this dialog needs first
        // refusal on every key press while it's open, both so the browser's own shortcuts (e.g.
        // Ctrl+K) never fire instead of being recorded, and so the app's own already-bound
        // shortcuts never trigger behind this modal while the user is choosing a replacement.
        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("keyup", onKeyUp, true);
        return () => {
            window.removeEventListener("keydown", onKeyDown, true);
            window.removeEventListener("keyup", onKeyUp, true);
        };
    }, []);

    const onSave = (): void => {
        if (combo && !error) onFinished(combo);
    };

    const onCancel = (): void => {
        onFinished();
    };

    return (
        <BaseDialog className="haven_RecordShortcutDialog" onFinished={onCancel} title={`Change shortcut: ${actionDisplayName}`}>
            <div className="mx_Dialog_content">
                {currentValue && (
                    <div className="haven_RecordShortcutDialog_current">
                        <span>Current shortcut</span>
                        <KeyboardShortcut value={currentValue} />
                    </div>
                )}

                <p>Press the key combination you want to use. It must include Ctrl or Alt.</p>

                <div className="haven_RecordShortcutDialog_capture">
                    {combo ? (
                        <KeyboardShortcut value={combo} />
                    ) : held.ctrlKey || held.altKey || held.shiftKey || held.metaKey ? (
                        // Live "still holding modifiers, waiting for the rest of the combo" preview
                        // - deliberately never passes `last` to any of these, so a trailing "+"
                        // always shows after whichever modifier was held most recently, same as
                        // KeyboardShortcut's own rendering does between its own chips.
                        <div className="mx_KeyboardShortcut">
                            {held.ctrlKey && <KeyboardKey name={Key.CONTROL} />}
                            {held.metaKey && <KeyboardKey name={Key.META} />}
                            {held.altKey && <KeyboardKey name={Key.ALT} />}
                            {held.shiftKey && <KeyboardKey name={Key.SHIFT} />}
                        </div>
                    ) : (
                        <span className="haven_RecordShortcutDialog_placeholder">Press a key combination…</span>
                    )}
                </div>

                {error && <div className="haven_RecordShortcutDialog_error">{error}</div>}
            </div>
            <DialogButtons
                primaryButton="Save"
                primaryDisabled={!combo || !!error}
                onPrimaryButtonClick={onSave}
                onCancel={onCancel}
                cancelButton="Cancel"
            />
        </BaseDialog>
    );
}

/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, {
    type JSX,
    useCallback,
    useEffect,
    useId,
    useRef,
    useState,
} from "react";
import { getEmojiFromUnicode } from "@matrix-org/emojibase-bindings";
import classNames from "classnames";

import { _t } from "../i18n/i18n";
import {
    EMOJI_SKIN_TONES,
    applySkinTone,
    type EmojiSkinTone,
} from "./skinTone";
import styles from "./EmojiPicker.module.css";

const HAND = getEmojiFromUnicode("👋");
if (!HAND) throw new Error("Emoji 👋 doesn't exist in emojibase");

const handIn = (tone: EmojiSkinTone): string =>
    applySkinTone(HAND, tone).unicode;

const TONE_LABEL: Record<EmojiSkinTone, TranslationKey> = {
    none: "emoji_picker|skin_tone_none",
    light: "emoji_picker|skin_tone_light",
    "medium-light": "emoji_picker|skin_tone_medium_light",
    medium: "emoji_picker|skin_tone_medium",
    "medium-dark": "emoji_picker|skin_tone_medium_dark",
    dark: "emoji_picker|skin_tone_dark",
};

interface IProps {
    /** The currently selected skin tone. */
    tone: EmojiSkinTone;
    /** Called with the newly chosen tone. */
    onChange: (tone: EmojiSkinTone) => void;
}

/**
 * Haven: a small button showing a hand in the current skin tone, which opens a row of every tone to
 * pick from. Sits to the right of the emoji picker's search box.
 */
export function SkinToneSelector({
    tone,
    onChange,
}: Readonly<IProps>): JSX.Element {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
    const menuId = useId();

    const close = useCallback((refocusButton: boolean): void => {
        setOpen(false);
        if (refocusButton) buttonRef.current?.focus();
    }, []);

    // Click anywhere outside closes it.
    useEffect(() => {
        if (!open) return;
        const onMouseDown = (ev: MouseEvent): void => {
            if (!rootRef.current?.contains(ev.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", onMouseDown);
        return () => document.removeEventListener("mousedown", onMouseDown);
    }, [open]);

    // Start on the current tone so arrow keys move relative to it.
    useEffect(() => {
        if (open) optionRefs.current[EMOJI_SKIN_TONES.indexOf(tone)]?.focus();
        // Only when it opens, not each time the tone changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const onKeyDown = useCallback(
        (ev: React.KeyboardEvent): void => {
            // Everything typed in here is this control's own business: the picker's roving-grid key
            // handler sits on an ancestor and would otherwise act on the arrow keys/Enter/Escape
            // too (moving grid focus, choosing an emoji, closing the whole picker). Default actions
            // (Tab moving focus, Enter/Space clicking a button) are unaffected by this.
            // A closed selector leaves Escape alone so it still closes the whole picker.
            if (ev.key !== "Tab" && !(ev.key === "Escape" && !open))
                ev.stopPropagation();
            if (!open) return;

            const current = optionRefs.current.findIndex(
                (option) => option === document.activeElement
            );
            const last = EMOJI_SKIN_TONES.length - 1;
            let next: number | undefined;
            switch (ev.key) {
                case "ArrowRight":
                case "ArrowDown":
                    next = current >= last ? 0 : current + 1;
                    break;
                case "ArrowLeft":
                case "ArrowUp":
                    next = current <= 0 ? last : current - 1;
                    break;
                case "Home":
                    next = 0;
                    break;
                case "End":
                    next = last;
                    break;
                case "Escape":
                    ev.preventDefault();
                    close(true);
                    return;
            }
            if (next !== undefined) {
                ev.preventDefault();
                optionRefs.current[next]?.focus();
            }
        },
        [open, close]
    );

    return (
        <div className={styles.skinTone} ref={rootRef} onKeyDown={onKeyDown}>
            <button
                type="button"
                ref={buttonRef}
                className={styles.skinToneButton}
                aria-label={_t("emoji_picker|skin_tone")}
                title={_t("emoji_picker|skin_tone")}
                aria-expanded={open}
                aria-controls={open ? menuId : undefined}
                onClick={() => setOpen((wasOpen) => !wasOpen)}
            >
                <span aria-hidden="true">{handIn(tone)}</span>
            </button>
            {open && (
                <div
                    id={menuId}
                    role="radiogroup"
                    aria-label={_t("emoji_picker|skin_tone")}
                    className={styles.skinToneMenu}
                >
                    {EMOJI_SKIN_TONES.map((option, index) => (
                        <button
                            key={option}
                            type="button"
                            role="radio"
                            aria-checked={option === tone}
                            aria-label={_t(TONE_LABEL[option])}
                            title={_t(TONE_LABEL[option])}
                            tabIndex={option === tone ? 0 : -1}
                            ref={(node) => {
                                optionRefs.current[index] = node;
                            }}
                            className={classNames(styles.skinToneOption, {
                                [styles.skinToneOptionSelected]:
                                    option === tone,
                            })}
                            onClick={() => {
                                onChange(option);
                                close(true);
                            }}
                        >
                            <span aria-hidden="true">{handIn(option)}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

/*
 * Copyright 2026 Element Creations Ltd.
 * Copyright 2020 The Matrix.org Foundation C.I.C.
 * Copyright 2019 Tulir Asokan <tulir@maunium.net>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { useCallback } from "react";
import { type Emoji as IEmoji } from "@matrix-org/emojibase-bindings";
import classNames from "classnames";

import { RovingButton, type ButtonEvent } from "./RovingButton";
import styles from "./EmojiPicker.module.css";

// Haven: a custom/pack emoji (MSC2545) is represented as a synthetic IEmoji-shaped stand-in (see
// apps/web/src/components/views/emojipicker/customEmoji.ts's own doc) carrying a pre-resolved
// image URL, rather than teaching this component matrix-specific mxc:// resolution directly - this
// package has no MatrixClient of its own to resolve one with, so the caller resolves it before the
// data ever reaches here. Optional so every plain unicode Emoji (the vast majority) is unaffected.
export interface PickerEmoji extends IEmoji {
    imageUrl?: string;
    /** Haven: a previously-sent freeform (non-emoji) reaction shown in Frequently Used - see
     *  EmojiPicker.tsx's own makeFreeformEmoji doc. Arbitrarily long text rather than a single
     *  glyph, so it needs different in-cell styling (.itemFreeform below) to stay legible. */
    isFreeform?: boolean;
}

interface IProps {
    /**
     * The emoji to render.
     */
    emoji: PickerEmoji;
    /**
     * Set of which emojis are already selected and should be decorated as such.
     * If specified, emoji will use a checkbox role with aria-checked set appropriately.
     */
    selectedEmojis?: Set<string>;
    /**
     * Called when the emoji is clicked.
     *
     * @param ev - The button event
     * @param emoji - The emoji that was clicked
     */
    onClick: (ev: ButtonEvent, emoji: PickerEmoji) => void;
    /**
     * Called when the mouse enters the emoji.
     *
     * @param emoji - The emoji that the mouse entered
     */
    onMouseEnter: (emoji: PickerEmoji) => void;
    /**
     * Called when the mouse leaves the emoji.
     *
     * @param emoji - The emoji that the mouse left
     */
    onMouseLeave: (emoji: PickerEmoji) => void;
    /**
     * If true, the emoji will be disabled and not clickable.
     */
    disabled?: boolean;
    /**
     * The id to use for the emoji button.
     */
    id?: string;
    /**
     * Optional class name to apply to the emoji button.
     */
    className?: string;
}

/**
 * A single emoji cell rendered in the emoji picker.
 */
export const Emoji = React.memo(function Emoji({
    onClick,
    onMouseEnter,
    onMouseLeave,
    emoji,
    selectedEmojis,
    disabled,
    id,
    className,
}: IProps): React.ReactNode {
    const isSelected = selectedEmojis?.has(emoji.unicode);

    const onMouseEnterWrapped = useCallback(() => onMouseEnter(emoji), [onMouseEnter, emoji]);
    const onMouseLeaveWrapped = useCallback(() => onMouseLeave(emoji), [onMouseLeave, emoji]);

    return (
        <RovingButton
            id={id}
            onClick={(ev) => onClick(ev, emoji)}
            onMouseEnter={onMouseEnterWrapped}
            onMouseLeave={onMouseLeaveWrapped}
            className={className}
            disabled={disabled || undefined}
            role={selectedEmojis ? "checkbox" : undefined}
            aria-checked={isSelected}
            focusOnMouseOver
        >
            <div
                className={classNames(styles.item, {
                    [styles.itemSelected]: isSelected,
                    [styles.itemFreeform]: emoji.isFreeform,
                })}
            >
                {emoji.imageUrl ? (
                    <img src={emoji.imageUrl} alt={emoji.label} className={styles.itemImage} />
                ) : (
                    emoji.unicode
                )}
            </div>
        </RovingButton>
    );
});

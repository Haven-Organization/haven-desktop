/*
 * Copyright 2026 Element Creations Ltd.
 * Copyright 2020 The Matrix.org Foundation C.I.C.
 * Copyright 2019 Tulir Asokan <tulir@maunium.net>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { useCallback, useState } from "react";
import { getEmojiFromUnicode, type Emoji as IEmoji } from "@matrix-org/emojibase-bindings";
import classNames from "classnames";

import { _t } from "../i18n/i18n";
import { Toolbar, type RovingTabIndexProviderProps } from "../roving";
import { Emoji } from "./Emoji";
import { type ButtonEvent } from "./RovingButton";
import styles from "./EmojiPicker.module.css";
import { Heading } from "@vector-im/compound-web";

// NB. This is the variation-selector Heart in Quick Reactions as per the spec)
const QUICK_REACTIONS = ["👍", "👎", "😄", "🎉", "😕", "❤️", "🚀", "👀"].map((emoji) => {
    const data = getEmojiFromUnicode(emoji);
    if (!data) {
        throw new Error(`Emoji ${emoji} doesn't exist in emojibase`);
    }
    return data;
});

interface IProps {
    /**
     * Set of emojis already selected.
     */
    selectedEmojis?: Set<string>;
    /**
     * Called when an emoji is clicked.
     *
     * @param ev - The button event
     * @param emoji - The emoji that was clicked
     */
    onClick: (ev: ButtonEvent, emoji: IEmoji) => void;
    /**
     * Optional function to override the default keyboard navigation mapping.
     * When omitted, a default mapping based on `KeyboardEvent.key` is used.
     */
    getAction?: RovingTabIndexProviderProps["getAction"];
}

/**
 * A row of quick reaction emojis at the bottom of the emoji picker.
 */
export const QuickReactions: React.FC<IProps> = ({ selectedEmojis, onClick, getAction }) => {
    const [hover, setHover] = useState<IEmoji | undefined>(undefined);

    const onMouseEnter = useCallback((emoji: IEmoji): void => {
        setHover(emoji);
    }, []);

    const onMouseLeave = useCallback((): void => {
        setHover(undefined);
    }, []);

    return (
        <section className={classNames(styles.footer, styles.quick, styles.category)}>
            <Heading as="h2" className={classNames(styles.quickHeader, styles.categoryLabel)}>
                {!hover ? (
                    _t("emoji|quick_reactions")
                ) : (
                    <React.Fragment>
                        <span className={styles.name}>{hover.label}</span>
                        <span className={styles.shortcode}>{hover.shortcodes[0]}</span>
                    </React.Fragment>
                )}
            </Heading>
            <Toolbar className={styles.list} aria-label={_t("emoji|quick_reactions")} getAction={getAction}>
                {QUICK_REACTIONS.map((emoji) => (
                    // Haven: .itemWrapper belongs on its own wrapping div, not passed straight through
                    // as Emoji's own className - that puts it on the same element as Emoji's internal
                    // RovingButton, whose .itemButton class (see EmojiPicker.module.css's own doc)
                    // fights .itemWrapper's fixed width/height for the same properties, stretching
                    // each quick-reaction button to fill the whole popup's height instead of its own
                    // 38x40 slot. EmojiPicker.tsx's own grid already uses this same wrapping-div
                    // pattern for exactly this reason - matching it here keeps both call sites
                    // consistent instead of just one of the two conflicting.
                    <div className={styles.itemWrapper} key={emoji.hexcode}>
                        <Emoji
                            emoji={emoji}
                            onClick={onClick}
                            onMouseEnter={onMouseEnter}
                            onMouseLeave={onMouseLeave}
                            selectedEmojis={selectedEmojis}
                        />
                    </div>
                ))}
            </Toolbar>
        </section>
    );
};

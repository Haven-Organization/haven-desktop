/*
 * Copyright 2026 Element Creations Ltd.
 * Copyright 2020 The Matrix.org Foundation C.I.C.
 * Copyright 2019 Tulir Asokan <tulir@maunium.net>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React from "react";
import classNames from "classnames";

import { type PickerEmoji } from "./Emoji";
import styles from "./EmojiPicker.module.css";

interface IProps {
    /**
     * The emoji to preview.
     */
    emoji: PickerEmoji;
}

/**
 * A preview of the selected emoji, showing the emoji itself, its name, and its shortcode.
 */
export const Preview: React.FC<IProps> = ({ emoji }) => {
    const {
        unicode,
        label,
        shortcodes: [shortcode],
        imageUrl,
    } = emoji;

    return (
        <div className={styles.footer}>
            <div className={styles.previewEmoji}>
                {/* Haven: a custom/pack emoji's own `unicode` is a synthetic `:shortcode:` string
                    (see customEmoji.ts's own makeCustomEmoji), not a real glyph - rendering it as
                    text here (like a real emoji's actual unicode) showed that whole string at
                    heading-xl font size, ballooning this box wide enough to push .previewText
                    itself out of the footer instead of showing the pack's own image. */}
                {imageUrl ? (
                    <img src={imageUrl} alt={label} className={styles.previewEmojiImage} />
                ) : (
                    unicode
                )}
            </div>
            <div className={styles.previewText}>
                <div className={classNames(styles.name, styles.previewName)}>{label}</div>
                <div className={styles.shortcode}>{shortcode}</div>
            </div>
        </div>
    );
};

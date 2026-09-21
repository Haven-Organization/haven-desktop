/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { type Emoji as IEmoji } from "@matrix-org/emojibase-bindings";

/**
 * Haven: the standard Unicode skin tones (Fitzpatrick scale modifiers U+1F3FB..U+1F3FF), plus "none"
 * for the default, unmodified (yellow) emoji.
 */
export type EmojiSkinTone =
    | "none"
    | "light"
    | "medium-light"
    | "medium"
    | "medium-dark"
    | "dark";

/** Every skin tone, in display order (default first, then light to dark). */
export const EMOJI_SKIN_TONES: readonly EmojiSkinTone[] = [
    "none",
    "light",
    "medium-light",
    "medium",
    "medium-dark",
    "dark",
];

const TONE_MODIFIER: Record<Exclude<EmojiSkinTone, "none">, number> = {
    light: 0x1f3fb,
    "medium-light": 0x1f3fc,
    medium: 0x1f3fd,
    "medium-dark": 0x1f3fe,
    dark: 0x1f3ff,
};

/** The Fitzpatrick modifier character for a tone ("" for "none"), e.g. to preview a tone on a base emoji. */
export function skinToneModifier(tone: EmojiSkinTone): string {
    return tone === "none" ? "" : String.fromCodePoint(TONE_MODIFIER[tone]);
}

const isModifier = (codepoint: number): boolean =>
    codepoint >= 0x1f3fb && codepoint <= 0x1f3ff;

/**
 * The emojibase compact data this picker is built on puts each emoji's skin variants under a
 * `skins` list but, unlike the full dataset, doesn't say which tone each one is - it has to be read
 * back off the Fitzpatrick modifier codepoints inside the variant itself.
 */
function modifiersOf(unicode: string): number[] {
    return Array.from(unicode, (char) => char.codePointAt(0)!).filter(
        isModifier
    );
}

/**
 * The given emoji in the given skin tone, or the emoji unchanged if it has no skin variants at all
 * (most don't) or none in that tone. Only the displayed glyph changes (unicode/hexcode/label) - the
 * shortcodes, tags and everything else stay the base emoji's, so searching and sorting behave
 * exactly as they would for the default tone.
 *
 * Multi-person emoji (couples, handshakes, ...) have a variant for every pair of tones; picking a
 * single tone chooses the one where everyone has that same tone.
 *
 * Only meant for a base emoji - a toned one has no `skins` of its own to look through.
 */
export function applySkinTone<T extends IEmoji>(
    emoji: T,
    tone: EmojiSkinTone
): T {
    if (tone === "none" || !emoji.skins?.length) return emoji;

    const modifier = TONE_MODIFIER[tone];
    const skin = emoji.skins.find((candidate) => {
        const modifiers = modifiersOf(candidate.unicode);
        return (
            modifiers.length > 0 && modifiers.every((each) => each === modifier)
        );
    });
    if (!skin) return emoji;

    return {
        ...emoji,
        unicode: skin.unicode,
        hexcode: skin.hexcode,
        label: skin.label ?? emoji.label,
    };
}

/**
 * The same emoji with any skin tone modifiers removed, i.e. back to the base emoji's unicode - e.g.
 * to look a previously-used toned emoji back up in the emoji data, which only knows base emoji.
 */
export function stripSkinTone(unicode: string): string {
    return Array.from(unicode)
        .filter((char) => !isModifier(char.codePointAt(0)!))
        .join("");
}

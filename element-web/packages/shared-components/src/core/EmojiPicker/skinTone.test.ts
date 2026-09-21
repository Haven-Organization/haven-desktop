/*
 * Haven: regression coverage for the emoji skin tone logic (picker + autocomplete both rely on it).
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { getEmojiFromUnicode } from "@matrix-org/emojibase-bindings";
import { describe, expect, it } from "vitest";

import {
    EMOJI_SKIN_TONES,
    applySkinTone,
    stripSkinTone,
    type EmojiSkinTone,
} from "./skinTone";

const emoji = (
    unicode: string
): NonNullable<ReturnType<typeof getEmojiFromUnicode>> => {
    const found = getEmojiFromUnicode(unicode);
    if (!found) throw new Error(`${unicode} not in emojibase`);
    return found;
};

const MODIFIERS: Record<Exclude<EmojiSkinTone, "none">, string> = {
    light: "🏻",
    "medium-light": "🏼",
    medium: "🏽",
    "medium-dark": "🏾",
    dark: "🏿",
};

describe("skinTone", () => {
    it("offers none plus the five standard tones, default first", () => {
        expect(EMOJI_SKIN_TONES).toEqual([
            "none",
            "light",
            "medium-light",
            "medium",
            "medium-dark",
            "dark",
        ]);
    });

    describe("applySkinTone", () => {
        it("returns the same object for the default tone", () => {
            const thumbsUp = emoji("👍");
            expect(applySkinTone(thumbsUp, "none")).toBe(thumbsUp);
        });

        it.each(Object.entries(MODIFIERS))(
            "applies the %s tone to a single-person emoji",
            (tone, modifier) => {
                const toned = applySkinTone(emoji("👍"), tone as EmojiSkinTone);
                expect(toned.unicode).toBe(`👍${modifier}`);
                expect(toned.hexcode).not.toBe(emoji("👍").hexcode);
            }
        );

        it("leaves emoji without skin variants untouched", () => {
            const rocket = emoji("🚀");
            expect(applySkinTone(rocket, "dark")).toBe(rocket);
        });

        it("picks the variant where every person has the chosen tone, for multi-person emoji", () => {
            const toned = applySkinTone(emoji("🤝"), "medium");
            const modifiers = [...toned.unicode].filter(
                (c) => c >= "\u{1F3FB}" && c <= "\u{1F3FF}"
            );
            expect(modifiers.length).toBeGreaterThan(0);
            expect(modifiers.every((m) => m === "\u{1F3FD}")).toBe(true);
        });

        it("does not mutate its input", () => {
            const thumbsUp = emoji("👍");
            const before = thumbsUp.unicode;
            applySkinTone(thumbsUp, "dark");
            expect(thumbsUp.unicode).toBe(before);
        });
    });

    describe("stripSkinTone", () => {
        it.each(Object.values(MODIFIERS))(
            "removes the %s modifier",
            (modifier) => {
                expect(stripSkinTone(`👍${modifier}`)).toBe("👍");
            }
        );

        it("leaves an untoned emoji alone", () => {
            expect(stripSkinTone("👍")).toBe("👍");
            expect(stripSkinTone("❤️")).toBe("❤️");
        });

        it("round-trips with applySkinTone so a toned recent resolves back to its base emoji", () => {
            const toned = applySkinTone(emoji("👋"), "medium-dark").unicode;
            expect(getEmojiFromUnicode(toned)).toBeUndefined();
            expect(getEmojiFromUnicode(stripSkinTone(toned))?.unicode).toBe(
                "👋"
            );
        });
    });
});

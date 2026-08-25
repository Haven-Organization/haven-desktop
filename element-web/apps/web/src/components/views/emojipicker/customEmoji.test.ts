import { describe, it, expect } from "vitest";

import { makeCustomEmoji, isCustomEmoji, type CustomEmojiLike } from "./customEmoji";
import { type ImagePackImageInfo } from "../../../utils/ImagePacks";

// Haven: regression coverage for the synthetic IEmoji-shaped stand-in a pack image is wrapped in so
// it flows through emojibase-bindings' own Category/Emoji/Preview/Header machinery unmodified.
describe("customEmoji", () => {
    describe("makeCustomEmoji", () => {
        it("builds an Emoji-shaped object carrying the pack image's identifying fields", () => {
            const info: ImagePackImageInfo = { mimetype: "image/png", w: 32, h: 32 };
            const emoji = makeCustomEmoji(
                "party_parrot",
                "mxc://example.org/abc123",
                "Party Pack",
                "!room:example.org",
                "party-pack",
                info,
            );

            expect(emoji.unicode).toBe(":party_parrot:");
            expect(emoji.label).toBe("party_parrot");
            expect(emoji.shortcodes).toEqual(["party_parrot"]);
            expect(emoji.mxcUrl).toBe("mxc://example.org/abc123");
            expect(emoji.packName).toBe("Party Pack");
            expect(emoji.roomId).toBe("!room:example.org");
            expect(emoji.stateKey).toBe("party-pack");
            expect(emoji.imageInfo).toBe(info);
            expect(emoji.isCustomEmoji).toBe(true);
        });

        it("derives a stable, pack-and-shortcode-scoped hexcode instead of a real unicode one", () => {
            const emoji = makeCustomEmoji("wave", "mxc://example.org/1", "Greetings", "!r:x", "greetings");
            expect(emoji.hexcode).toBe("custom-Greetings-wave");
        });

        it("two different packs sharing a shortcode still get distinct hexcodes", () => {
            const a = makeCustomEmoji("wave", "mxc://example.org/1", "Pack A", "!r:x", "a");
            const b = makeCustomEmoji("wave", "mxc://example.org/2", "Pack B", "!r:x", "b");
            expect(a.hexcode).not.toBe(b.hexcode);
        });

        it("leaves imageInfo undefined when none is given", () => {
            const emoji = makeCustomEmoji("wave", "mxc://example.org/1", "Pack", "!r:x", "pack");
            expect(emoji.imageInfo).toBeUndefined();
        });
    });

    describe("isCustomEmoji", () => {
        it("returns true for an object built by makeCustomEmoji", () => {
            const emoji = makeCustomEmoji("wave", "mxc://example.org/1", "Pack", "!r:x", "pack");
            expect(isCustomEmoji(emoji)).toBe(true);
        });

        it("returns false for a plain real-emoji-shaped object with no isCustomEmoji flag", () => {
            const realEmoji = {
                unicode: "👋",
                label: "waving hand",
                shortcodes: ["wave"],
                hexcode: "1F44B",
            } as unknown as CustomEmojiLike;
            expect(isCustomEmoji(realEmoji)).toBe(false);
        });

        it("returns false when isCustomEmoji is falsy rather than strictly absent", () => {
            const almost = {
                unicode: ":x:",
                label: "x",
                shortcodes: ["x"],
                hexcode: "custom-p-x",
                isCustomEmoji: false,
            } as unknown as CustomEmojiLike;
            expect(isCustomEmoji(almost)).toBe(false);
        });
    });
});

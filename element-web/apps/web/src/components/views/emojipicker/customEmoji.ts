/*
 * Haven: MSC2545 (Image Packs) — custom emoji as synthetic IEmoji-shaped stand-ins.
 *
 * Mirrors EmojiPicker.tsx's own makeFreeformEmoji technique: rather than teaching Category/Emoji/
 * Preview/Header a second, parallel data shape, a pack image is represented as an object satisfying
 * the same `Emoji` shape @matrix-org/emojibase-bindings expects (unicode/label/shortcodes/hexcode),
 * with extra fields identifying it as custom - so it flows through the exact same virtualized grid,
 * filtering, and roving-tabindex machinery as a real emoji, just rendered as an <img> instead of a
 * unicode glyph wherever isCustomEmoji(...) is checked.
 */

import { type Emoji as IEmoji } from "@matrix-org/emojibase-bindings";

import { type ImagePackImageInfo } from "../../../utils/ImagePacks";

export interface CustomEmojiLike extends IEmoji {
    mxcUrl: string;
    packName: string;
    isCustomEmoji: true;
    /** Haven: which room/state_key this image's own m.room.image_pack pack lives under - needed to
     *  build MSC4459's `image_source_packs` field when this image is sent as a sticker. */
    roomId: string;
    stateKey: string;
    /** Haven: this image's own stored dimensions/mimetype/size (see ImagePacks.ts's own
     *  ImagePackImageInfo doc) - carried along so a sticker send has real info instead of `{}`. */
    imageInfo?: ImagePackImageInfo;
}

/** Handed to onChoose alongside the plain string value whenever the choice was a custom (pack)
 *  emoji rather than a real unicode one - lets a caller that cares (the composer, to render it
 *  inline - see MessageComposer.tsx/BasicMessageComposer.tsx) tell the two apart, while callers
 *  that don't care (ReactionPicker, which just sends whatever string it's given as the reaction
 *  key) keep working unchanged. */
export interface CustomEmojiChoice {
    shortcode: string;
    mxcUrl: string;
    packName: string;
    roomId: string;
    stateKey: string;
    imageInfo?: ImagePackImageInfo;
}

export function makeCustomEmoji(
    shortcode: string,
    mxcUrl: string,
    packName: string,
    roomId: string,
    stateKey: string,
    imageInfo?: ImagePackImageInfo,
): CustomEmojiLike {
    const value = `:${shortcode}:`;
    return {
        unicode: value,
        label: shortcode,
        shortcodes: [shortcode],
        hexcode: `custom-${packName}-${shortcode}`,
        emoticon: undefined,
        mxcUrl,
        packName,
        roomId,
        stateKey,
        imageInfo,
        isCustomEmoji: true,
    } as unknown as CustomEmojiLike;
}

export function isCustomEmoji(emoji: IEmoji): emoji is CustomEmojiLike {
    return (emoji as Partial<CustomEmojiLike>).isCustomEmoji === true;
}

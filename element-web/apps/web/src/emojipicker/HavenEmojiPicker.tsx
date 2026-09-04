/*
 * Haven: wraps the shared-components EmojiPicker with everything specific to this app's own
 * MSC2545 image pack / MSC4459 custom-reaction feature - the shared component itself only knows
 * about a generic "extra categories with an already-resolved image URL" shape (see EmojiPicker.tsx
 * in shared-components), not matrix rooms, mxc:// URLs, or pack permissions.
 *
 * Used in place of the bare shared-components EmojiPickerWithRecents by ReactionPicker.tsx and
 * EmojiButton.tsx, the two places this app actually needs pack/sticker support.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
    type Category,
    EmojiPicker as SharedEmojiPicker,
    type EmojiPickerProps as SharedEmojiPickerProps,
    type PickerEmoji,
} from "@element-hq/web-shared-components";
import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

import * as recent from "./recent";
import { getWebRovingAction } from "../accessibility/RovingTabIndex";
import { _t } from "../languageHandler";
import AccessibleButton from "../components/views/elements/AccessibleButton";
import { type CustomEmojiChoice, isCustomEmoji, makeCustomEmoji } from "../components/views/emojipicker/customEmoji";
import {
    type ImagePackUsage,
    type RoomImagePack,
    getEmoticonPacks,
    getRoomImagePacks,
    getPackAvatarMxc,
    canManageImagePacks,
    imagesForUsage,
    packDisplayName,
} from "../utils/ImagePacks";
import { mediaFromMxc } from "../customisations/Media";
import {
    ensurePackImageAnimatedChecked,
    getCachedPackImageAnimated,
    useAnimatedImageCacheVersion,
} from "../utils/PackImageAnimationCache";
import {
    ensureAnimatedThumbnailSupportChecked,
    getAnimatedThumbnailUrl,
    getCachedAnimatedThumbnailSupport,
    useAnimatedThumbnailSupportVersion,
} from "../utils/AnimatedThumbnailSupport";
import dis from "../dispatcher/dispatcher";
import { Action } from "../dispatcher/actions";
import { UserTab } from "../components/views/dialogs/UserTab";
import { RoomSettingsTab } from "../components/views/dialogs/RoomSettingsDialog-tab";
import { setPendingManagePackStateKey } from "../utils/pendingManagePack";

interface IProps {
    selectedEmojis?: Set<string>;
    onChoose(unicode: string, custom?: CustomEmojiChoice): boolean;
    onFinished(): void;
    isEmojiDisabled?: (unicode: string) => boolean;
    /** See shared-components EmojiPickerProps.showQuickReactions - defaulted off for sticker mode
     *  by this wrapper (quick reactions/preview are meaningless for stickers), forwarded verbatim
     *  otherwise. */
    showQuickReactions?: boolean;
    /** Haven: shows a "React with '<text>'" option below the search box, sending whatever's typed
     *  as a literal freeform m.reaction key - only meaningful where onChoose sends a reaction
     *  (ReactionPicker), not plain emoji-insert-into-composer usage (EmojiButton). */
    allowFreeformReaction?: boolean;
    /** Haven: the room this picker is being shown for - lets it show that room's own MSC2545 image
     *  packs (plus the user's favorited packs from other rooms) as extra rail categories. Omit
     *  entirely (e.g. no room context available) to fall back to the plain stock unicode-only
     *  picker. */
    room?: Room;
    /** Haven: "emoji" (default) shows the normal unicode categories plus any emoji/both image
     *  packs. "sticker" replaces the whole picker with sticker/both image packs only. */
    mode?: "emoji" | "sticker";
    /** Haven: hides this room's own custom emoji pack categories in "emoji" mode (no effect in
     *  "sticker" mode). Set when the caller is composing in the true rich-text editor, whose
     *  underlying @vector-im/matrix-wysiwyg crate has no way to insert a custom emoji as anything
     *  but literal `:shortcode:` text. */
    disableCustomEmoji?: boolean;
}

/** Haven: the SAME imageUrl this size produces is reused for two different on-screen sizes - the
 *  actual grid cell itself (see EmojiPicker.module.css's own .itemWrapper/.itemWrapperSticker),
 *  and the bigger 56px hover-preview shelf shown at the bottom of the picker (see its own
 *  .previewEmojiImage - Preview.tsx renders the exact same PickerEmoji.imageUrl there, fetching no
 *  separate, bigger image of its own). Sized for the larger of the two - a thumbnail a bit bigger
 *  than the grid cell needs is imperceptible once downscaled slightly to fit it, but one sized
 *  for the grid cell alone gets visibly, unavoidably upscale-blurred once shown at the preview's
 *  own bigger size (confirmed live 2026-09-04: a real static, correctly-thumbnailed 32px pack
 *  image looked blurry specifically in the preview shelf, not the grid, for exactly this reason).
 *  getSquareThumbnailHttp already accounts for devicePixelRatio on top of this. */
const EMOJI_IMAGE_SIZE = 64;
const STICKER_IMAGE_SIZE = 76;

/** Haven: a pack category's own icon in the rail (see EmojiPicker.module.css's own .anchorIcon) -
 *  same 36x36 box .anchor itself already reserves for a plain emoji glyph. */
const RAIL_ICON_SIZE = 36;

/** A thumbnail sized for `size`, falling back to the original image if no thumbnail is available
 *  (e.g. an invalid mxc:// URL) rather than rendering nothing. */
function thumbnailUrl(mxcUrl: string, client: MatrixClient, size: number): string | undefined {
    const media = mediaFromMxc(mxcUrl, client);
    return media.getSquareThumbnailHttp(size) ?? media.srcHttp ?? undefined;
}

function buildPackCategories(
    room: Room | undefined,
    usage: ImagePackUsage,
): { categories: Category[]; dataByCategory: Record<string, PickerEmoji[]> } {
    if (!room) return { categories: [], dataByCategory: {} };

    const userId = room.client.getSafeUserId();
    const packs: RoomImagePack[] = getEmoticonPacks(room, usage);

    const categories: Category[] = [];
    const dataByCategory: Record<string, PickerEmoji[]> = {};
    for (const pack of packs) {
        const id = `pack:${pack.roomId}:${pack.stateKey}`;
        const name = packDisplayName(pack.content, pack.stateKey);
        const avatarMxc = getPackAvatarMxc(pack, room.client);
        const packRoom = room.client.getRoom(pack.roomId);
        const manageable = !!(packRoom && canManageImagePacks(packRoom, userId));
        // Haven: was .srcHttp (the original, full-resolution image, and per getPackAvatarMxc's own
        // fallback chain - own avatar -> source room's avatar -> first image in the pack - not even
        // guaranteed to be a small avatar-shaped image at all). Unlike a grid cell (see imageUrl's
        // own doc below), this rail icon is never virtualized: EVERY favorited pack's icon mounts
        // and starts fetching/decoding the moment the picker opens, regardless of scroll position or
        // which category is showing. For an account with many favorited packs across many rooms,
        // that's dozens-to-hundreds of full-resolution (sometimes animated-GIF) decodes on every
        // single open, unbounded by pack count and never cached across opens - confirmed as the
        // actual cause of a real account's renderer OOMing. A 36x36px rail icon losing an animation
        // is a far smaller loss than a grid cell's (see imageUrl below), so this one thumbnails
        // unconditionally rather than special-casing animated sources.
        categories.push({
            id,
            name,
            emoji: "🖼️",
            iconUrl: avatarMxc ? thumbnailUrl(avatarMxc, room.client, RAIL_ICON_SIZE) : undefined,
            manageRoomId: manageable ? pack.roomId : undefined,
            manageStateKey: manageable ? pack.stateKey : undefined,
        } as Category & { manageRoomId?: string; manageStateKey?: string });
        const imageSize = usage === "sticker" ? STICKER_IMAGE_SIZE : EMOJI_IMAGE_SIZE;
        dataByCategory[id] = imagesForUsage(pack, usage).map(({ shortcode, image }) => {
            const custom = makeCustomEmoji(shortcode, image.url, name, pack.roomId, pack.stateKey, image.info);
            // Haven: was .srcHttp (the original, full-resolution image) - for a grid of dozens/
            // hundreds of tiny cells that's a lot of unnecessary decode work piling up as the
            // picker scrolls and mounts more of them, easily enough to exhaust the renderer's heap
            // for an account with many favorited packs. A properly-sized server-side thumbnail is
            // what this cell actually needs - EXCEPT when the source itself may be animated:
            // ImagePacks.ts's own upload path (see generateThumbnail's doc there) deliberately
            // generates thumbnail_url as an always-STATIC single-frame fallback for clients that
            // can't render a large/animated sticker at all, not a smaller animated copy - using it
            // here would silently freeze every animated custom emoji/sticker in the grid despite
            // the category rail's own icon (iconUrl above, never thumbnailed) still animating fine.
            //
            // A plain mimetype guess alone was flagging the large majority of ordinary static pack
            // images - the common case, not the exception - as animated, sending every one of them
            // down the full-original-resolution path above with no size cap at all. Confirmed live
            // 2026-08-19 against a real reported-slow pack: 12 genuinely static PNGs at ~800x750px
            // real resolution each (vs. this cell's own ~30px), none carrying the real
            // "org.matrix.msc4230.is_animated" answer (added before that field existed) - every
            // single one loading full-res on every single open. That persisted answer is preferred
            // when present; PackImageAnimationCache (see its own doc) covers the rest - a legacy
            // image with no persisted answer - with a real, cached-or-in-progress client-side
            // check instead of the mimetype guess, optimistically assuming static (the common
            // case) rather than animated while a check is still in flight.
            const persistedAnimated = image.info?.["org.matrix.msc4230.is_animated"];
            if (persistedAnimated === undefined) ensurePackImageAnimatedChecked(image.url, room.client);
            const isAnimated = persistedAnimated ?? getCachedPackImageAnimated(image.url) ?? false;
            // Haven: an animated image still gets a small, crisp thumbnail when this homeserver's
            // own media repo actually honours it (see AnimatedThumbnailSupport.ts's own doc) -
            // most don't (confirmed live against a real deployment), so this only kicks in once
            // that's been genuinely confirmed, never assumed. Falls back to exactly today's
            // existing behavior (the full original, softened by the browser's own 10-20x
            // downscale into this tiny grid cell) otherwise.
            if (isAnimated) ensureAnimatedThumbnailSupportChecked(image.url, room.client);
            const animatedThumbnailSupported = getCachedAnimatedThumbnailSupport(room.client.baseUrl);
            const imageUrl = isAnimated
                ? animatedThumbnailSupported
                    ? getAnimatedThumbnailUrl(image.url, room.client, imageSize)
                    : (mediaFromMxc(image.url, room.client).srcHttp ?? undefined)
                : thumbnailUrl(image.url, room.client, imageSize);
            return {
                ...custom,
                imageUrl,
            };
        });
    }

    if (getRoomImagePacks(room).length === 0 && canManageImagePacks(room, userId)) {
        const id = `pack-create:${room.roomId}`;
        const avatarMxc = room.getMxcAvatarUrl();
        categories.push({
            id,
            name: room.name,
            emoji: "🖼️",
            iconUrl: avatarMxc ? (mediaFromMxc(avatarMxc, room.client).srcHttp ?? undefined) : undefined,
            isEmptyState: true,
        } as Category & { createRoomId: string });
        dataByCategory[id] = [];
    }

    return { categories, dataByCategory };
}

function openSettings(): void {
    dis.dispatch({ action: Action.ViewUserSettings, initialTabId: UserTab.EmojiStickers });
}

function openManagePack(roomId: string, stateKey?: string): void {
    if (stateKey !== undefined) setPendingManagePackStateKey(stateKey);
    dis.dispatch({
        action: "open_room_settings",
        room_id: roomId,
        initial_tab_id: RoomSettingsTab.EmojiStickers,
    });
}

/**
 * Haven's own emoji/sticker picker: the shared-components picker plus room image packs, sticker
 * mode, and (in ReactionPicker) freeform-text reactions.
 */
export function HavenEmojiPicker({
    selectedEmojis,
    onChoose,
    onFinished,
    isEmojiDisabled,
    showQuickReactions,
    allowFreeformReaction,
    room,
    mode = "emoji",
    disableCustomEmoji,
}: IProps): React.ReactNode {
    const [filter, setFilter] = useState("");
    const recentEmojis = useMemo(() => recent.get(), []);

    const stickerMode = mode === "sticker";
    const packUsage: ImagePackUsage = stickerMode ? "sticker" : "emoticon";
    const packRoom = !stickerMode && disableCustomEmoji ? undefined : room;
    // animatedCacheVersion/animatedThumbnailSupportVersion have no direct effect of their own -
    // they're dependencies purely so this memo recomputes (picking up a fresh
    // getCachedPackImageAnimated/getCachedAnimatedThumbnailSupport answer) once a background check
    // kicked off inside buildPackCategories resolves - see PackImageAnimationCache's and
    // AnimatedThumbnailSupport's own docs.
    const animatedCacheVersion = useAnimatedImageCacheVersion();
    const animatedThumbnailSupportVersion = useAnimatedThumbnailSupportVersion();
    const { categories: packCategories, dataByCategory: dataByPackCategory } = useMemo(
        () => buildPackCategories(packRoom, packUsage),
        [packRoom, packUsage, animatedCacheVersion, animatedThumbnailSupportVersion],
    );

    // Haven: sticker mode has no unicode-emoji grid to fall back on, unlike emoji mode - with zero
    // pack categories it'd otherwise render nothing at all. Synthesize an isEmptyState category
    // (same shape buildPackCategories itself already uses for its own "you can create a pack" case
    // just above) so the "no stickers in this room" message still renders *inside* SharedEmojiPicker
    // and inherits its fixed .picker size, instead of the caller having to bail out into a bare,
    // unstyled div that only shrink-wraps to the message text (see renderEmptyStateCategory's own
    // stickerMode branch below for the message itself).
    const stickerCategories = useMemo<{ categories: Category[]; dataByCategory: Record<string, PickerEmoji[]> }>(() => {
        if (!stickerMode) return { categories: [], dataByCategory: {} };
        if (packCategories.length > 0) return { categories: packCategories, dataByCategory: dataByPackCategory };
        const id = `no-stickers:${room?.roomId ?? "none"}`;
        return {
            categories: [{ id, name: room?.name ?? "", emoji: "🖼️", isEmptyState: true } as Category],
            dataByCategory: { [id]: [] },
        };
    }, [stickerMode, packCategories, dataByPackCategory, room]);

    // Haven: whether the "no stickers" empty state (just above) should also offer a "Create New
    // Pack" link alongside the "Favorite Packs" one - same permission buildPackCategories itself
    // already checks for its own "you can create a pack" case, recomputed here since that decision
    // lives inside a memo the component doesn't otherwise have visibility into.
    const canCreatePack = useMemo(
        () => (room ? canManageImagePacks(room, room.client.getSafeUserId()) : false),
        [room],
    );

    const onManageClick = useCallback((roomId: string, stateKey?: string) => {
        onFinished();
        openManagePack(roomId, stateKey);
    }, [onFinished]);

    const onOpenSettings = useCallback(() => {
        onFinished();
        openSettings();
    }, [onFinished]);

    const handleChoose = useCallback<SharedEmojiPickerProps["onChoose"]>(
        (unicode, emoji) => {
            if (emoji && isCustomEmoji(emoji)) {
                return onChoose(unicode, {
                    shortcode: emoji.shortcodes[0],
                    mxcUrl: emoji.mxcUrl,
                    packName: emoji.packName,
                    roomId: emoji.roomId,
                    stateKey: emoji.stateKey,
                    imageInfo: emoji.imageInfo,
                });
            }
            return onChoose(unicode);
        },
        [onChoose],
    );

    const onClickFreeformReact = useCallback(() => {
        const text = filter.trim();
        if (!text) return;
        if (onChoose(text) !== false) recent.add(text);
        onFinished();
    }, [filter, onChoose, onFinished]);

    const renderEmptyStateCategory = useCallback(
        (_category: Category) => {
            const roomId = room?.roomId;
            if (stickerMode) {
                if (canCreatePack && roomId) {
                    return (
                        <>
                            {_t(
                                "emoji_picker|no_stickers_in_room_can_create",
                                {},
                                {
                                    a: (sub) => (
                                        <AccessibleButton kind="link_inline" onClick={() => onManageClick(roomId)}>
                                            {sub}
                                        </AccessibleButton>
                                    ),
                                    b: (sub) => (
                                        <AccessibleButton kind="link_inline" onClick={onOpenSettings}>
                                            {sub}
                                        </AccessibleButton>
                                    ),
                                },
                            )}
                        </>
                    );
                }
                return (
                    <>
                        {_t(
                            "emoji_picker|no_stickers_in_room",
                            {},
                            {
                                a: (sub) => (
                                    <AccessibleButton kind="link_inline" onClick={onOpenSettings}>
                                        {sub}
                                    </AccessibleButton>
                                ),
                            },
                        )}
                    </>
                );
            }
            if (!roomId) return null;
            return (
                <>
                    {_t(
                        "emoji_picker|create_pack_prompt",
                        {},
                        {
                            a: (sub) => (
                                <AccessibleButton kind="link_inline" onClick={() => onManageClick(roomId)}>
                                    {sub}
                                </AccessibleButton>
                            ),
                        },
                    )}
                </>
            );
        },
        [room, onManageClick, stickerMode, onOpenSettings, canCreatePack],
    );

    return (
        <SharedEmojiPicker
            selectedEmojis={selectedEmojis}
            onChoose={handleChoose}
            onFinished={onFinished}
            isEmojiDisabled={isEmojiDisabled}
            getAction={getWebRovingAction}
            onOpenSettings={onOpenSettings}
            recentEmojis={stickerMode ? undefined : recentEmojis}
            onRecordRecent={recent.add}
            showQuickReactions={showQuickReactions ?? !stickerMode}
            mode={mode}
            extraCategories={stickerMode ? undefined : packCategories}
            dataByExtraCategory={stickerMode ? undefined : dataByPackCategory}
            stickerCategories={stickerMode ? stickerCategories.categories : undefined}
            dataByStickerCategory={stickerMode ? stickerCategories.dataByCategory : undefined}
            renderEmptyStateCategory={renderEmptyStateCategory}
            onFilterChange={setFilter}
            onFreeformEnter={allowFreeformReaction ? onClickFreeformReact : undefined}
            belowSearch={
                allowFreeformReaction &&
                filter.trim() && (
                    <AccessibleButton
                        kind="link"
                        className="mx_HavenEmojiPicker_freeformReact"
                        onClick={onClickFreeformReact}
                    >
                        {_t("emoji_picker|react_with_text", { text: filter.trim() })}
                    </AccessibleButton>
                )
            }
        />
    );
}

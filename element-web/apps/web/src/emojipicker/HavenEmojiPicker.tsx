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
import { type Room } from "matrix-js-sdk/src/matrix";

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

/** Haven: the grid cell a pack emoji/sticker actually renders into (see EmojiPicker.module.css's
 *  own .itemWrapper/.itemWrapperSticker) - used to request a properly-sized thumbnail rather than
 *  the original image (see buildPackCategories' own imageUrl doc for why this matters). A little
 *  larger than the CSS box itself for a bit of headroom; getSquareThumbnailHttp already accounts
 *  for devicePixelRatio on top of this. */
const EMOJI_IMAGE_SIZE = 32;
const STICKER_IMAGE_SIZE = 76;

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
        categories.push({
            id,
            name,
            emoji: "🖼️",
            iconUrl: avatarMxc ? (mediaFromMxc(avatarMxc, room.client).srcHttp ?? undefined) : undefined,
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
            // what this cell actually needs.
            const media = mediaFromMxc(image.url, room.client);
            return {
                ...custom,
                imageUrl: media.getSquareThumbnailHttp(imageSize) ?? media.srcHttp ?? undefined,
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
    const { categories: packCategories, dataByCategory: dataByPackCategory } = useMemo(
        () => buildPackCategories(packRoom, packUsage),
        [packRoom, packUsage],
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

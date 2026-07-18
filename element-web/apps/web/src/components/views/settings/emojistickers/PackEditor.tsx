/*
 * Haven: MSC2545 (Image Packs) — the "View" sub-page shared by the room settings and user settings
 * "Emoji & Stickers" tabs (see EmojiStickersRoomSettingsTab.tsx and EmojiStickersUserSettingsTab.tsx).
 *
 * `canManage` is a read-only viewer's permission on the pack's own source room, not necessarily the
 * room the settings dialog was opened from - a favorited pack viewed from user settings can belong
 * to any joined room. When false, editing controls stay visible rather than disappearing outright:
 * the Edit toggle (pack header and each image row) is shown but disabled/greyed out so it's clear
 * editing exists but isn't available, while the ✕ remove buttons and the add-image controls are
 * hidden entirely (removing/adding isn't a "greyed out" affordance the way editing is - there's
 * nothing to preview by leaving them visible).
 */

import React, { type JSX, useCallback, useMemo, useState } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";
import { AutoHideScrollbar } from "@element-hq/web-shared-components";

import { _t } from "../../../../languageHandler";
import SettingsTab from "../tabs/SettingsTab";
import { SettingsSection } from "../shared/SettingsSection";
import { SettingsSubsection } from "../shared/SettingsSubsection";
import AccessibleButton from "../../elements/AccessibleButton";
import Field from "../../elements/Field";
import Spinner from "../../elements/Spinner";
import { getFileChanged } from "../AvatarSetting";
import { chromeFileInputFix } from "../../../../utils/BrowserWorkarounds";
import {
    type ImagePackContent,
    type ImagePackImage,
    type ImagePackImageInfo,
    type ImagePackUsage,
    type RoomImagePack,
    saveRoomImagePack,
    getPackAvatarMxc,
    effectiveImageUsage,
    uploadPackImage,
    addPackImageFromMxcUrl,
    shortcodeFromMxcUrl,
    sanitizeShortcode,
} from "../../../../utils/ImagePacks";

export function PackAvatar({ mxcUrl, room, size = "32px" }: { mxcUrl?: string; room: Room; size?: string }): JSX.Element {
    // Haven: no width/height/method - see Emoji.tsx's own identical doc, this must stay a
    // /download/ so an animated (gif) pack avatar still animates in its own settings preview.
    const httpUrl = mxcUrl ? room.client.mxcUrlToHttp(mxcUrl) : null;
    return httpUrl ? (
        <img className="mx_EmojiStickersSettingsTab_avatar" src={httpUrl} style={{ width: size, height: size }} alt="" />
    ) : (
        <div className="mx_EmojiStickersSettingsTab_avatar mx_EmojiStickersSettingsTab_avatar_placeholder" style={{ width: size, height: size }} />
    );
}

interface DraftImage {
    /** The key this image is stored under in m.room.image_pack's own `images` map - `null` for
     *  a not-yet-saved image freshly added in this draft (a real key is chosen from its shortcode
     *  at Save time, once the user's stopped editing it). */
    key: string | null;
    shortcode: string;
    url: string;
    body: string;
    usage: ImagePackUsage[];
    info?: ImagePackImageInfo;
    editing?: boolean;
}

export interface PackEditorProps {
    room: Room;
    pack: RoomImagePack;
    canManage: boolean;
    onBack: () => void;
}

function buildDraftImages(content: ImagePackContent): DraftImage[] {
    return Object.entries(content.images).map(([key, image]) => ({
        key,
        shortcode: key,
        url: image.url,
        body: image.body ?? "",
        usage: effectiveImageUsage(image, content),
        info: image.info,
    }));
}

const USAGE_OPTIONS: { value: "emoticon" | "sticker" | "both"; labelKey: string }[] = [
    { value: "both", labelKey: "room_settings|emoji_stickers|usage_both" },
    { value: "emoticon", labelKey: "room_settings|emoji_stickers|usage_emoji" },
    { value: "sticker", labelKey: "room_settings|emoji_stickers|usage_sticker" },
];

function usageArrayToSelectValue(usage: ImagePackUsage[]): "emoticon" | "sticker" | "both" {
    const hasEmoticon = usage.includes("emoticon");
    const hasSticker = usage.includes("sticker");
    if (hasEmoticon && hasSticker) return "both";
    if (hasSticker) return "sticker";
    return "emoticon";
}

function selectValueToUsageArray(value: "emoticon" | "sticker" | "both"): ImagePackUsage[] {
    if (value === "both") return ["emoticon", "sticker"];
    return [value];
}

export function PackEditor({ room, pack, canManage, onBack }: PackEditorProps): JSX.Element {
    const client = room.client;
    const [displayName, setDisplayName] = useState(pack.content.pack?.display_name ?? pack.stateKey);
    const [avatarUrl, setAvatarUrl] = useState(pack.content.pack?.avatar_url);
    const [packUsage, setPackUsage] = useState<ImagePackUsage[]>(
        pack.content.pack?.usage?.length ? pack.content.pack.usage : ["emoticon", "sticker"],
    );
    const [images, setImages] = useState<DraftImage[]>(() => buildDraftImages(pack.content));
    const [editingMeta, setEditingMeta] = useState(false);
    const [busy, setBusy] = useState(false);
    const [dirty, setDirty] = useState(false);

    const markDirty = useCallback(() => setDirty(true), []);

    const [addImageError, setAddImageError] = useState<string | null>(null);

    const handleAvatarFile = useCallback(
        async (file: File): Promise<void> => {
            setBusy(true);
            try {
                const { mxcUrl } = await uploadPackImage(client, file);
                setAvatarUrl(mxcUrl);
                markDirty();
            } finally {
                setBusy(false);
            }
        },
        [client, markDirty],
    );

    const handleAddImage = useCallback(
        async (file: File): Promise<void> => {
            setBusy(true);
            try {
                const { mxcUrl, info } = await uploadPackImage(client, file);
                const shortcode = sanitizeShortcode(file.name);
                setImages((prev) => [
                    ...prev,
                    { key: null, shortcode, url: mxcUrl, body: shortcode, usage: packUsage, info },
                ]);
                markDirty();
            } finally {
                setBusy(false);
            }
        },
        [client, packUsage, markDirty],
    );

    const [mxcUrlInput, setMxcUrlInput] = useState("");

    const handleAddImageFromMxc = useCallback(async (): Promise<void> => {
        const mxcUrl = mxcUrlInput.trim();
        if (!mxcUrl) return;
        setBusy(true);
        setAddImageError(null);
        try {
            const { info } = await addPackImageFromMxcUrl(client, mxcUrl);
            const shortcode = shortcodeFromMxcUrl(mxcUrl);
            setImages((prev) => [...prev, { key: null, shortcode, url: mxcUrl, body: shortcode, usage: packUsage, info }]);
            setMxcUrlInput("");
            markDirty();
        } catch (err) {
            setAddImageError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    }, [client, mxcUrlInput, packUsage, markDirty]);

    const updateImage = useCallback(
        (index: number, patch: Partial<DraftImage>) => {
            setImages((prev) => prev.map((img, i) => (i === index ? { ...img, ...patch } : img)));
            markDirty();
        },
        [markDirty],
    );

    const removeImage = useCallback(
        (index: number) => {
            setImages((prev) => prev.filter((_, i) => i !== index));
            markDirty();
        },
        [markDirty],
    );

    // Haven: filters by index rather than filtering `images` directly, so updateImage/removeImage
    // (both index-into-the-full-array operations) still target the right draft image regardless
    // of what the search has currently hidden.
    const [imageQuery, setImageQuery] = useState("");
    const lcImageQuery = imageQuery.trim().toLowerCase();
    const filteredImageIndices = useMemo(() => {
        if (!lcImageQuery) return images.map((_, i) => i);
        return images
            .map((img, i) => ({ img, i }))
            .filter(
                ({ img }) =>
                    img.shortcode.toLowerCase().includes(lcImageQuery) || img.body.toLowerCase().includes(lcImageQuery),
            )
            .map(({ i }) => i);
    }, [images, lcImageQuery]);

    const handleSave = useCallback(async (): Promise<void> => {
        setBusy(true);
        try {
            const imagesContent: Record<string, ImagePackImage> = {};
            for (const img of images) {
                const key = img.shortcode.trim() || img.key || "image";
                imagesContent[key] = {
                    url: img.url,
                    body: img.body.trim() || undefined,
                    usage: img.usage,
                    info: img.info,
                };
            }
            const content: ImagePackContent = {
                pack: {
                    display_name: displayName.trim() || pack.stateKey,
                    avatar_url: avatarUrl,
                    usage: packUsage,
                },
                images: imagesContent,
            };
            await saveRoomImagePack(client, room.roomId, pack.stateKey, content);
            setDirty(false);
            setEditingMeta(false);
        } finally {
            setBusy(false);
        }
    }, [client, room, pack.stateKey, displayName, avatarUrl, packUsage, images]);

    return (
        <SettingsTab>
            <SettingsSection heading={_t("room_settings|emoji_stickers|title")}>
                <div className="mx_EmojiStickersSettingsTab_backBar">
                    <AccessibleButton kind="primary_outline" onClick={onBack}>
                        {`← ${_t("action|back")}`}
                    </AccessibleButton>
                </div>
                <SettingsSubsection>
                    <div className="mx_EmojiStickersSettingsTab_packHeader">
                        {/* Haven: avatarUrl is the pack's own saved/edited avatar and stays undefined
                            until the user actually sets one (see handleSave) - the display-only
                            fallback to the room's avatar or the pack's first image only kicks in
                            when avatarUrl itself has nothing to show. */}
                        <PackAvatar mxcUrl={avatarUrl ?? getPackAvatarMxc(pack, client)} room={room} size="56px" />
                        <div className="mx_EmojiStickersSettingsTab_packHeaderInfo">
                            {editingMeta ? (
                                <Field
                                    label={_t("room_settings|emoji_stickers|pack_name")}
                                    value={displayName}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                        setDisplayName(e.currentTarget.value);
                                        markDirty();
                                    }}
                                />
                            ) : (
                                <h3 className="mx_EmojiStickersSettingsTab_packHeaderName">{displayName}</h3>
                            )}
                        </div>
                        {editingMeta && canManage && (
                            <label className="mx_EmojiStickersSettingsTab_uploadBtn">
                                <AccessibleButton kind="primary_outline" element="span" onClick={() => {}}>
                                    {_t("room_settings|emoji_stickers|edit_avatar")}
                                </AccessibleButton>
                                <input
                                    type="file"
                                    accept="image/*"
                                    style={{ display: "none" }}
                                    onClick={chromeFileInputFix}
                                    onChange={(e) => {
                                        const file = getFileChanged(e);
                                        if (file) void handleAvatarFile(file);
                                    }}
                                />
                            </label>
                        )}
                        <AccessibleButton
                            kind="primary_outline"
                            onClick={() => setEditingMeta((v) => !v)}
                            disabled={!canManage}
                        >
                            {editingMeta ? _t("action|done") : _t("action|edit")}
                        </AccessibleButton>
                        {canManage && !editingMeta && (
                            // Haven: invisible spacer matching the image rows' Remove (✕) button so this
                            // row's Edit button lines up horizontally with each image row's Edit button -
                            // only needed when the rows below actually show a Remove button (canManage).
                            <AccessibleButton
                                kind="danger_outline"
                                className="mx_EmojiStickersSettingsTab_removeBtn"
                                aria-hidden="true"
                                tabIndex={-1}
                                style={{ visibility: "hidden" }}
                                onClick={() => {}}
                            >
                                ✕
                            </AccessibleButton>
                        )}
                    </div>

                    <div className="mx_EmojiStickersSettingsTab_usageRow">
                        <label htmlFor="mx_EmojiStickersSettingsTab_usage">
                            {_t("room_settings|emoji_stickers|images_usage")}
                        </label>
                        <Field
                            id="mx_EmojiStickersSettingsTab_usage"
                            element="select"
                            value={usageArrayToSelectValue(packUsage)}
                            disabled={!canManage}
                            onChange={(e) => {
                                setPackUsage(
                                    selectValueToUsageArray(
                                        e.currentTarget.value as "emoticon" | "sticker" | "both",
                                    ),
                                );
                                markDirty();
                            }}
                        >
                            {USAGE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {_t(opt.labelKey as Parameters<typeof _t>[0])}
                                </option>
                            ))}
                        </Field>
                    </div>
                </SettingsSubsection>

                <SettingsSubsection heading={_t("room_settings|emoji_stickers|images")}>
                    {images.length > 0 && (
                        <Field
                            className="mx_EmojiStickersSettingsTab_imageSearch"
                            label={_t("room_settings|emoji_stickers|search_images")}
                            value={imageQuery}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setImageQuery(e.currentTarget.value)}
                        />
                    )}
                    <AutoHideScrollbar className="mx_AutoHideScrollbar mx_EmojiStickersSettingsTab_imageList">
                        {filteredImageIndices.length === 0 && lcImageQuery ? (
                            <div className="mx_EmojiStickersSettingsTab_empty">
                                {_t("room_settings|emoji_stickers|no_images_match")}
                            </div>
                        ) : (
                            filteredImageIndices.map((i) => {
                                const img = images[i];
                                return (
                                    <PackImageRow
                                        key={img.key ?? `new-${i}`}
                                        room={room}
                                        image={img}
                                        canManage={canManage}
                                        onChange={(patch) => updateImage(i, patch)}
                                        onRemove={() => removeImage(i)}
                                    />
                                );
                            })
                        )}
                    </AutoHideScrollbar>
                    {canManage && (
                        <div className="mx_EmojiStickersSettingsTab_addImageRow">
                            <label className="mx_EmojiStickersSettingsTab_uploadBtn mx_EmojiStickersSettingsTab_uploadImage">
                                <AccessibleButton kind="primary_outline" element="span" onClick={() => {}}>
                                    {_t("room_settings|emoji_stickers|upload_image")}
                                </AccessibleButton>
                                <input
                                    type="file"
                                    accept="image/*"
                                    style={{ display: "none" }}
                                    onClick={chromeFileInputFix}
                                    onChange={(e) => {
                                        const file = getFileChanged(e);
                                        if (file) void handleAddImage(file);
                                        e.currentTarget.value = "";
                                    }}
                                />
                            </label>
                            <span className="mx_EmojiStickersSettingsTab_addImageOr">
                                {_t("room_settings|emoji_stickers|or")}
                            </span>
                            <Field
                                label={_t("room_settings|emoji_stickers|mxc_url")}
                                value={mxcUrlInput}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                    setMxcUrlInput(e.currentTarget.value);
                                    setAddImageError(null);
                                }}
                                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                                    if (e.key === "Enter") void handleAddImageFromMxc();
                                }}
                                disabled={busy}
                            />
                            <AccessibleButton
                                kind="primary_outline"
                                onClick={handleAddImageFromMxc}
                                disabled={busy || !mxcUrlInput.trim()}
                            >
                                {_t("action|add")}
                            </AccessibleButton>
                        </div>
                    )}
                    {addImageError && <div className="mx_EmojiStickersSettingsTab_error">{addImageError}</div>}
                    {busy && <Spinner />}
                </SettingsSubsection>

                {canManage && (
                    <div className="mx_EmojiStickersSettingsTab_saveBar">
                        <AccessibleButton kind="primary" onClick={handleSave} disabled={busy || !dirty}>
                            {_t("action|save")}
                        </AccessibleButton>
                    </div>
                )}
            </SettingsSection>
        </SettingsTab>
    );
}

interface PackImageRowProps {
    room: Room;
    image: DraftImage;
    canManage: boolean;
    onChange: (patch: Partial<DraftImage>) => void;
    onRemove: () => void;
}

function PackImageRow({ room, image, canManage, onChange, onRemove }: PackImageRowProps): JSX.Element {
    // Haven: no width/height/method - see Emoji.tsx's own identical doc, this must stay a
    // /download/ so an animated (gif) emoji/sticker still animates in its own settings preview.
    const httpUrl = room.client.mxcUrlToHttp(image.url);

    if (image.editing) {
        return (
            <div className="mx_EmojiStickersSettingsTab_imageRow mx_EmojiStickersSettingsTab_imageRow_editing">
                {httpUrl && <img className="mx_EmojiStickersSettingsTab_imageThumb" src={httpUrl} alt="" />}
                <div className="mx_EmojiStickersSettingsTab_imageEditFields">
                    <Field
                        label={_t("room_settings|emoji_stickers|shortcode")}
                        value={image.shortcode}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ shortcode: e.currentTarget.value })}
                    />
                    <Field
                        label={_t("room_settings|emoji_stickers|body")}
                        value={image.body}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ body: e.currentTarget.value })}
                    />
                    <Field
                        element="select"
                        label={_t("room_settings|emoji_stickers|image_usage")}
                        value={usageArrayToSelectValue(image.usage)}
                        onChange={(e) =>
                            onChange({ usage: selectValueToUsageArray(e.currentTarget.value as "emoticon" | "sticker" | "both") })
                        }
                    >
                        {USAGE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                                {_t(opt.labelKey as Parameters<typeof _t>[0])}
                            </option>
                        ))}
                    </Field>
                </div>
                <AccessibleButton kind="primary_outline" onClick={() => onChange({ editing: false })}>
                    {_t("action|done")}
                </AccessibleButton>
            </div>
        );
    }

    return (
        <div className="mx_EmojiStickersSettingsTab_imageRow">
            {httpUrl && <img className="mx_EmojiStickersSettingsTab_imageThumb" src={httpUrl} alt="" />}
            <span className="mx_EmojiStickersSettingsTab_imageShortcode" title={`:${image.shortcode}:`}>
                {`:${image.shortcode}:`}
            </span>
            <AccessibleButton kind="primary_outline" onClick={() => onChange({ editing: true })} disabled={!canManage}>
                {_t("action|edit")}
            </AccessibleButton>
            {canManage && (
                <AccessibleButton
                    kind="danger_outline"
                    className="mx_EmojiStickersSettingsTab_removeBtn"
                    onClick={onRemove}
                    title={_t("action|remove")}
                >
                    ✕
                </AccessibleButton>
            )}
        </div>
    );
}

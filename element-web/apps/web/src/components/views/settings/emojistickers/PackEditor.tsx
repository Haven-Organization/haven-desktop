/*
 * Haven: MSC2545 (Image Packs) — the "View" sub-page shared by the room settings and user settings
 * "Emoji & Stickers" tabs (see EmojiStickersRoomSettingsTab.tsx and EmojiStickersUserSettingsTab.tsx).
 *
 * Every field here (avatar, name, usage, each image) is editable in place, with no separate "Edit
 * mode" to enter first - edits only live in local draft state (`displayName`/`avatarUrl`/
 * `packUsage`/`images`) until the "Save Changes" button actually writes them as a real
 * m.room.image_pack state event (see handleSave). "Discard Changes" (and choosing to discard out
 * of the unsaved-changes dialog the navigation guard below pops up) throws that draft state away
 * and rebuilds it from `pack.content` - the pack's own last-saved state - via discardChanges.
 *
 * `canManage` is a read-only viewer's permission on the pack's own source room, not necessarily the
 * room the settings dialog was opened from - a favorited pack viewed from user settings can belong
 * to any joined room. When false, editing controls stay visible rather than disappearing outright:
 * the pack name/avatar/usage and each image's own Edit button are shown but disabled/greyed out so
 * it's clear editing exists but isn't available, while the ✕ remove buttons and the add-image
 * controls are hidden entirely (removing/adding isn't a "greyed out" affordance the way editing is
 * - there's nothing to preview by leaving them visible).
 */

import React, { type JSX, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";
import { IconButton, Menu, MenuItem } from "@vector-im/compound-web";
import EditIcon from "@vector-im/compound-design-tokens/assets/web/icons/edit";
import UploadIcon from "@vector-im/compound-design-tokens/assets/web/icons/share";
import LinkIcon from "@vector-im/compound-design-tokens/assets/web/icons/link";
import CloseIcon from "@vector-im/compound-design-tokens/assets/web/icons/close";
import classNames from "classnames";
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
import Modal from "../../../../Modal";
import TextInputDialog from "../../dialogs/TextInputDialog";
import QuestionDialog from "../../dialogs/QuestionDialog";
import { useSettingsNavigationGuard } from "../../../../contexts/SettingsNavigationGuardContext";
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

interface PackAvatarEditMenuProps {
    trigger: ReactNode;
    onUploadSelect: () => void;
    onMxcSelect: () => void;
    menuOpen: boolean;
    onOpenChange: (open: boolean) => void;
}

// Haven: same mini menu pattern as AvatarSetting.tsx's own AvatarSettingContextMenu (pencil icon
// opens a Compound Menu), swapped for what a pack avatar actually needs - upload a file, or point
// straight at an mxc:// URL already on the server - rather than user-avatar's own upload/remove.
function PackAvatarEditMenu({ trigger, onUploadSelect, onMxcSelect, menuOpen, onOpenChange }: PackAvatarEditMenuProps): JSX.Element {
    return (
        <Menu
            trigger={trigger}
            title={_t("room_settings|emoji_stickers|edit_avatar")}
            showTitle={false}
            open={menuOpen}
            onOpenChange={onOpenChange}
        >
            <MenuItem
                as="div"
                Icon={<UploadIcon width="24px" height="24px" />}
                label={_t("room_settings|emoji_stickers|upload_image")}
                onSelect={onUploadSelect}
            />
            <MenuItem
                as="div"
                Icon={<LinkIcon width="24px" height="24px" />}
                label={_t("room_settings|emoji_stickers|use_mxc_url")}
                onSelect={onMxcSelect}
            />
        </Menu>
    );
}

interface PackAvatarEditProps {
    room: Room;
    mxcUrl?: string;
    disabled: boolean;
    onFileSelected: (file: File) => void;
    onMxcSelected: () => void;
    size?: string;
}

// Haven: larger pack avatar with an always-visible edit pencil (see requirement 2) - structured
// the same way as AvatarSetting.tsx's own avatar+pencil+menu grouping so it opens the same kind of
// mini menu, just with pack-relevant options (see PackAvatarEditMenu above).
function PackAvatarEdit({ room, mxcUrl, disabled, onFileSelected, onMxcSelected, size = "80px" }: PackAvatarEditProps): JSX.Element {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [menuOpen, setMenuOpen] = useState(false);

    const avatarElement = (
        <AccessibleButton
            element="div"
            // This button opens a menu via the `trigger` prop below, hence the empty onClick.
            onClick={() => {}}
            className="mx_EmojiStickersSettingsTab_avatarEditTrigger"
            disabled={disabled}
        >
            <PackAvatar mxcUrl={mxcUrl} room={room} size={size} />
        </AccessibleButton>
    );

    if (disabled) {
        return <div className="mx_EmojiStickersSettingsTab_avatarEdit">{avatarElement}</div>;
    }

    const editButtonClasses = classNames("mx_EmojiStickersSettingsTab_avatarEditButton", {
        mx_EmojiStickersSettingsTab_avatarEditButton_active: menuOpen,
    });

    const content = (
        <div className="mx_EmojiStickersSettingsTab_avatarEdit" role="group" aria-label={_t("room_settings|emoji_stickers|edit_avatar")}>
            {avatarElement}
            <div className={editButtonClasses} role="button" aria-label={_t("room_settings|emoji_stickers|edit_avatar")} tabIndex={0} aria-haspopup="menu">
                <EditIcon aria-hidden={true} width="16px" height="16px" />
            </div>
        </div>
    );

    return (
        <>
            <PackAvatarEditMenu
                trigger={content}
                onUploadSelect={() => fileInputRef.current?.click()}
                onMxcSelect={onMxcSelected}
                menuOpen={menuOpen}
                onOpenChange={setMenuOpen}
            />
            <input
                type="file"
                style={{ display: "none" }}
                ref={fileInputRef}
                onClick={chromeFileInputFix}
                onChange={(e) => {
                    const file = getFileChanged(e);
                    if (file) onFileSelected(file);
                    e.currentTarget.value = "";
                }}
                accept="image/*"
                alt={_t("action|upload")}
            />
        </>
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

/** Haven: the pack's own last-saved fields, in the same shape the draft state below uses - the
 *  single source of truth `dirty` (further down) is computed against, and what discardChanges/
 *  handleSave reset/refresh it to. Kept as its own explicit snapshot (captured once on mount, then
 *  only ever updated by this component's own successful save) rather than re-deriving straight
 *  from the `pack` prop on every render - `pack` only reflects a save once the room's own state
 *  has actually caught up with it, which can lag a moment behind the save itself. */
interface PackSnapshot {
    displayName: string;
    avatarUrl?: string;
    usage: ImagePackUsage[];
    images: DraftImage[];
}

function snapshotFromContent(content: ImagePackContent, stateKey: string): PackSnapshot {
    return {
        displayName: content.pack?.display_name ?? stateKey,
        avatarUrl: content.pack?.avatar_url,
        usage: content.pack?.usage?.length ? content.pack.usage : ["emoticon", "sticker"],
        images: buildDraftImages(content),
    };
}

function usageArraysEqual(a: ImagePackUsage[], b: ImagePackUsage[]): boolean {
    return a.length === b.length && a.every((v) => b.includes(v));
}

// Haven: images are conceptually an unordered map (m.room.image_pack's own `images` is a
// Record, not a list), so this matches by `key` rather than by array position - an edit that
// only reorders untouched images (which nothing here actually lets you do today, but nothing
// should rely on that) must never register as dirty on its own. A freshly-added, not-yet-saved
// image always has `key: null` and so can never match anything in `saved`, correctly counting
// as a real difference.
function draftImagesEqual(current: DraftImage[], saved: DraftImage[]): boolean {
    if (current.length !== saved.length) return false;
    const savedByKey = new Map(saved.map((img) => [img.key, img]));
    return current.every((img) => {
        if (img.key === null) return false;
        const orig = savedByKey.get(img.key);
        return (
            !!orig &&
            img.shortcode === orig.shortcode &&
            img.url === orig.url &&
            img.body === orig.body &&
            usageArraysEqual(img.usage, orig.usage) &&
            JSON.stringify(img.info ?? null) === JSON.stringify(orig.info ?? null)
        );
    });
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
    const [savedSnapshot, setSavedSnapshot] = useState<PackSnapshot>(() =>
        snapshotFromContent(pack.content, pack.stateKey),
    );
    const [displayName, setDisplayName] = useState(savedSnapshot.displayName);
    const [avatarUrl, setAvatarUrl] = useState(savedSnapshot.avatarUrl);
    const [packUsage, setPackUsage] = useState<ImagePackUsage[]>(savedSnapshot.usage);
    const [images, setImages] = useState<DraftImage[]>(savedSnapshot.images);
    const [busy, setBusy] = useState(false);

    const [addImageError, setAddImageError] = useState<string | null>(null);

    const handleAvatarFile = useCallback(
        async (file: File): Promise<void> => {
            setBusy(true);
            try {
                const { mxcUrl } = await uploadPackImage(client, file);
                setAvatarUrl(mxcUrl);
            } finally {
                setBusy(false);
            }
        },
        [client],
    );

    const handleAvatarMxc = useCallback(async (): Promise<void> => {
        const { finished } = Modal.createDialog(TextInputDialog, {
            title: _t("room_settings|emoji_stickers|avatar_from_mxc_title"),
            description: _t("room_settings|emoji_stickers|avatar_from_mxc_description"),
            placeholder: _t("room_settings|emoji_stickers|mxc_url"),
            button: _t("action|add"),
        });
        const [ok, value] = await finished;
        if (ok && value?.trim()) {
            setAvatarUrl(value.trim());
        }
    }, []);

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
            } finally {
                setBusy(false);
            }
        },
        [client, packUsage],
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
        } catch (err) {
            setAddImageError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    }, [client, mxcUrlInput, packUsage]);

    const updateImage = useCallback((index: number, patch: Partial<DraftImage>) => {
        setImages((prev) => prev.map((img, i) => (i === index ? { ...img, ...patch } : img)));
    }, []);

    const removeImage = useCallback((index: number) => {
        setImages((prev) => prev.filter((_, i) => i !== index));
    }, []);

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
            // Haven: captured explicitly rather than waiting for the `pack` prop to catch up (see
            // PackSnapshot's own doc) - `dirty` below is derived straight from this, so it clears
            // the instant the save resolves rather than however long the room's own state takes to
            // reflect it.
            setSavedSnapshot(snapshotFromContent(content, pack.stateKey));
        } finally {
            setBusy(false);
        }
    }, [client, room, pack.stateKey, displayName, avatarUrl, packUsage, images]);

    // Haven: reverts every local draft field back to `savedSnapshot` - shared by the "Discard
    // Changes" button and by choosing to discard out of the unsaved-changes dialog below. Nothing
    // here needs to reset `dirty` itself or `nameCommitted` below - both are derived from these
    // same fields, so they clear themselves the instant the fields match savedSnapshot again.
    const discardChanges = useCallback((): void => {
        setDisplayName(savedSnapshot.displayName);
        setAvatarUrl(savedSnapshot.avatarUrl);
        setPackUsage(savedSnapshot.usage);
        setImages(savedSnapshot.images);
        setAddImageError(null);
    }, [savedSnapshot]);

    // Haven: the pack name's own Cancel button (see the JSX below) shows whenever `displayName`
    // differs from the pack's own last-saved name, rather than reusing Compound's EditInPlace,
    // whose show/hide is driven by internal focus-tracking that doesn't survive clicking away from
    // the field (and flickers on Cancel - see this component's own bug history).
    const nameEdited = displayName !== savedSnapshot.displayName;

    // Haven: whether the name field's own pending edit should count toward the whole pack's dirty
    // state below - set on blur (see onDisplayNameBlur), separate from `nameEdited` so a real but
    // still-in-progress edit doesn't mark the pack dirty on every keystroke, only once you've
    // switched focus away from the field with an actual change in place. Reset back to false the
    // instant the edit is undone - Cancel, or manually retyping back to the saved name - by the
    // effect below, so an undone edit can never leave the pack looking dirty (the bug this whole
    // savedSnapshot/derived-`dirty` design replaced a plain one-way "dirty" flag to fix).
    const [nameCommitted, setNameCommitted] = useState(false);
    useEffect(() => {
        if (!nameEdited) setNameCommitted(false);
    }, [nameEdited]);

    const onDisplayNameChanged = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
        setDisplayName(e.target.value);
    }, []);

    const onDisplayNameBlur = useCallback((): void => {
        if (nameEdited) setNameCommitted(true);
    }, [nameEdited]);

    const cancelNameEdit = useCallback((): void => {
        setDisplayName(savedSnapshot.displayName);
    }, [savedSnapshot]);

    // Haven: the single source of truth for whether this pack has anything unsaved - computed
    // fresh every render from the actual difference between the live draft and savedSnapshot,
    // rather than a one-way flag various handlers used to set with no way to un-set it short of a
    // full Discard Changes. `nameEdited && nameCommitted` (not just `nameEdited`) keeps the name
    // field's own blur-gating (see onDisplayNameBlur above) while still correctly going back to
    // false the instant `nameEdited` does, without waiting for the effect above to run first -
    // `nameEdited` is already up to date in the very same render Cancel fires in, since it's
    // derived directly from `displayName`, not a separate piece of state.
    const dirty =
        (nameEdited && nameCommitted) ||
        avatarUrl !== savedSnapshot.avatarUrl ||
        !usageArraysEqual(packUsage, savedSnapshot.usage) ||
        !draftImagesEqual(images, savedSnapshot.images);

    // Haven: shows the unsaved-changes confirmation, resolving true ("proceed") only if the user
    // explicitly picks Discard Changes (which this also carries out) - resolves false for every
    // other way of leaving the dialog (Escape, backdrop, "Go Back" itself), which must never lose
    // data. Shared by the navigation guard below and the in-page Back button.
    const confirmDiscard = useCallback((): Promise<boolean> => {
        // Haven: Modal.createDialog always overwrites a caller-supplied `onFinished` prop with its
        // own close handler (see Modal.tsx's own buildModal - it spreads props first, then sets
        // onFinished itself) - the only way to actually observe the result is via the `finished`
        // promise it returns, same as e.g. NetworkDropdown.tsx's own TextInputDialog usage. A plain
        // `onFinished` prop here would silently never run.
        const { finished } = Modal.createDialog(QuestionDialog, {
            title: _t("room_settings|emoji_stickers|unsaved_changes_dialog_title"),
            description: _t("room_settings|emoji_stickers|unsaved_changes_dialog_description"),
            button: _t("room_settings|emoji_stickers|go_back"),
            cancelButton: _t("room_settings|emoji_stickers|discard_changes"),
            cancelButtonClass: "danger",
        });
        return finished.then(([goBack]) => {
            if (goBack !== false) return false;
            discardChanges();
            return true;
        });
    }, [discardChanges]);

    // Haven: lets the settings dialog itself (its own close - X button/Escape/clicking outside it
    // - and switching to another sidebar category) block on this pack's own unsaved changes - see
    // SettingsNavigationGuardContext's own doc.
    const { setGuard } = useSettingsNavigationGuard();
    useEffect(() => {
        setGuard(dirty ? confirmDiscard : null);
        return () => setGuard(null);
    }, [dirty, setGuard, confirmDiscard]);

    // Haven: the in-page Back button is a plain in-tree action, not something the navigation guard
    // above needs to be involved in - it can just show the same confirmation directly.
    const handleBack = useCallback((): void => {
        if (!dirty) {
            onBack();
            return;
        }
        void confirmDiscard().then((proceed) => {
            if (proceed) onBack();
        });
    }, [dirty, confirmDiscard, onBack]);

    return (
        <SettingsTab>
            <SettingsSection heading={_t("room_settings|emoji_stickers|title")}>
                <div className="mx_EmojiStickersSettingsTab_backBar">
                    <AccessibleButton kind="primary_outline" onClick={handleBack}>
                        {`← ${_t("action|back")}`}
                    </AccessibleButton>
                    {dirty && (
                        <span className="mx_EmojiStickersSettingsTab_unsavedWarning">
                            {_t("room_settings|emoji_stickers|unsaved_changes")}
                        </span>
                    )}
                </div>
                <SettingsSubsection>
                    <div className="mx_EmojiStickersSettingsTab_packHeader">
                        {/* Haven: avatarUrl is the pack's own saved/edited avatar and stays undefined
                            until the user actually sets one (see handleSave) - the display-only
                            fallback to the room's avatar or the pack's first image only kicks in
                            when avatarUrl itself has nothing to show. */}
                        <PackAvatarEdit
                            room={room}
                            mxcUrl={avatarUrl ?? getPackAvatarMxc(pack, client)}
                            disabled={!canManage}
                            onFileSelected={(file) => void handleAvatarFile(file)}
                            onMxcSelected={() => void handleAvatarMxc()}
                        />
                        <div className="mx_EmojiStickersSettingsTab_packHeaderInfo">
                            <div className="mx_EmojiStickersSettingsTab_packNameEdit">
                                <Field
                                    label={_t("room_settings|emoji_stickers|pack_name")}
                                    value={displayName}
                                    onChange={onDisplayNameChanged}
                                    onBlur={onDisplayNameBlur}
                                    disabled={!canManage}
                                />
                                {nameEdited && canManage && (
                                    <div className="mx_EmojiStickersSettingsTab_packNameEditButtons">
                                        <IconButton
                                            kind="secondary"
                                            tooltip={_t("common|cancel")}
                                            onClick={cancelNameEdit}
                                        >
                                            <CloseIcon />
                                        </IconButton>
                                    </div>
                                )}
                            </div>
                        </div>
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
                        {dirty && (
                            <AccessibleButton kind="danger_outline" onClick={discardChanges} disabled={busy}>
                                {_t("room_settings|emoji_stickers|discard_changes")}
                            </AccessibleButton>
                        )}
                        <AccessibleButton kind="primary" onClick={handleSave} disabled={busy || !dirty}>
                            {_t("room_settings|emoji_stickers|save_changes")}
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

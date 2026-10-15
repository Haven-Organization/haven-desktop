/*
 * Haven: MSC2545 (Image Packs) — "Add to Pack" dialog.
 *
 * Opened from MessageContextMenu's own "Add to Pack" option on an image/sticker message (see
 * ImagePacks.ts's own getPackableImageFromEvent for exactly which messages qualify). Lists every
 * pack the user can manage, searchable by pack name or the room it lives in, each with a stylized
 * button that adds the message's image to it in one click - no draft/Save step, unlike the room
 * settings tab's own pack editor.
 *
 * Above the list are the shortcode, usage and description the image gets in whichever pack is
 * picked. They start from what the image already had if it came out of a pack (see
 * getAddToPackDefaults), otherwise from its file name.
 *
 * Also opened from ReactionsDialog for a custom emoji reaction, which has no packable event of its
 * own - that passes the image in directly as `image` instead of `mxEvent`.
 */

import React, { type JSX, useCallback, useMemo, useState } from "react";
import { EventType, type MatrixClient, type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { AutoHideScrollbar } from "@element-hq/web-shared-components";

import BaseDialog from "./BaseDialog";
import { _t } from "../../../languageHandler";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import AccessibleButton from "../elements/AccessibleButton";
import Field from "../elements/Field";
import Spinner from "../elements/Spinner";
import {
    type ImagePackUsage,
    type RoomImagePack,
    effectiveImageUsage,
    getManageableImagePacks,
    getRoomImagePacksForManagement,
    sanitizeShortcode,
    shortcodeFromMxcUrl,
    getPackableImageFromEvent,
    getPackAvatarMxc,
    packDisplayName,
    addPackImageFromMxcUrl,
    addImageToExistingPack,
} from "../../../utils/ImagePacks";
import { IMAGE_SOURCE_PACKS_KEY, type ImageSourcePackRef } from "../../../utils/imageSourcePacks";

/** An image to add to a pack, with whatever is already known about it. */
export interface AddToPackImage {
    mxcUrl: string;
    /** Its description or file name. */
    body?: string;
    /** The shortcode it was used under, without colons. */
    shortcode?: string;
    /** How it was used, when the pack it came from is not available to say. */
    usage?: ImagePackUsage[];
    /** The pack it came from (MSC4459), if the event said. */
    packRef?: ImageSourcePackRef;
}

interface Props {
    /** The image or sticker message to add. Not needed when `image` is given. */
    mxEvent?: MatrixEvent;
    /** The image to add, for one that is not a message of its own (a custom emoji reaction). */
    image?: AddToPackImage;
    onFinished: (added?: boolean) => void;
}

type UsageChoice = "emoticon" | "sticker" | "both";

const USAGE_OPTIONS: { value: UsageChoice; labelKey: string }[] = [
    { value: "both", labelKey: "room_settings|emoji_stickers|usage_both" },
    { value: "emoticon", labelKey: "room_settings|emoji_stickers|usage_emoji" },
    { value: "sticker", labelKey: "room_settings|emoji_stickers|usage_sticker" },
];

function usageToChoice(usage: ImagePackUsage[]): UsageChoice {
    const emoticon = usage.includes("emoticon");
    const sticker = usage.includes("sticker");
    if (emoticon === sticker) return "both";
    return sticker ? "sticker" : "emoticon";
}

function choiceToUsage(choice: UsageChoice): ImagePackUsage[] {
    return choice === "both" ? ["emoticon", "sticker"] : [choice];
}

/** What "Add to Pack" can offer for a message: its image, plus the pack reference for that image
 *  when the message carries one. */
function imageFromEvent(mxEvent: MatrixEvent): AddToPackImage | undefined {
    const image = getPackableImageFromEvent(mxEvent);
    if (!image) return undefined;
    const refs = mxEvent.getContent()[IMAGE_SOURCE_PACKS_KEY] as Record<string, ImageSourcePackRef> | undefined;
    const packRef = refs && typeof refs === "object" ? refs[image.mxcUrl] : undefined;
    return {
        ...image,
        packRef,
        shortcode: packRef?.shortcode,
        usage: mxEvent.getType() === EventType.Sticker ? ["sticker"] : undefined,
    };
}

/** The values the dialog's fields start with. An image that came out of a pack keeps the
 *  shortcode, description and usage it has there, as far as they can be found: the pack itself
 *  when the user is in its room, otherwise what the event carried. Anything else starts from its
 *  file name. Exported for tests. */
export function getAddToPackDefaults(
    client: MatrixClient,
    image: AddToPackImage,
): { shortcode: string; description: string; usage: UsageChoice } {
    const ref = image.packRef;
    const sourceRoom = ref ? client.getRoom(ref.room_id) : null;
    const sourcePack = sourceRoom
        ? getRoomImagePacksForManagement(sourceRoom).find((pack) => pack.stateKey === ref!.state_key)
        : undefined;
    const sourceImage = sourcePack
        ? (sourcePack.content.images[ref!.shortcode] ??
          Object.values(sourcePack.content.images).find((candidate) => candidate.url === image.mxcUrl))
        : undefined;

    const shortcode = image.shortcode || (image.body ? sanitizeShortcode(image.body) : shortcodeFromMxcUrl(image.mxcUrl));
    const usage =
        sourceImage && sourcePack ? effectiveImageUsage(sourceImage, sourcePack.content) : (image.usage ?? []);
    return {
        shortcode,
        description: sourceImage?.body ?? image.body ?? shortcode,
        usage: usageToChoice(usage),
    };
}

function packKey(pack: RoomImagePack): string {
    return `${pack.roomId} ${pack.stateKey}`;
}

function PackRowAvatar({ pack }: { pack: RoomImagePack }): JSX.Element {
    const client = MatrixClientPeg.safeGet();
    // Haven: no width/height/method - see emojipicker/Emoji.tsx's own identical doc, this must
    // stay a /download/ so an animated (gif) pack avatar still animates here too.
    const mxcUrl = getPackAvatarMxc(pack, client);
    const httpUrl = mxcUrl ? client.mxcUrlToHttp(mxcUrl) : null;
    return httpUrl ? (
        <img className="mx_AddToPackDialog_rowAvatar" src={httpUrl} alt="" />
    ) : (
        <div className="mx_AddToPackDialog_rowAvatar mx_AddToPackDialog_rowAvatar_placeholder" />
    );
}

export default function AddToPackDialog({ mxEvent, image: givenImage, onFinished }: Props): JSX.Element {
    const client = MatrixClientPeg.safeGet();
    const packs = useMemo(() => getManageableImagePacks(client), [client]);
    const image = useMemo(
        () => givenImage ?? (mxEvent ? imageFromEvent(mxEvent) : undefined),
        [givenImage, mxEvent],
    );
    const defaults = useMemo(() => (image ? getAddToPackDefaults(client, image) : undefined), [client, image]);

    const [shortcode, setShortcode] = useState(defaults?.shortcode ?? "");
    const [description, setDescription] = useState(defaults?.description ?? "");
    const [usage, setUsage] = useState<UsageChoice>(defaults?.usage ?? "both");

    const [query, setQuery] = useState("");
    const [busyKey, setBusyKey] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const lcQuery = query.trim().toLowerCase();
    const filteredPacks = useMemo(() => {
        if (!lcQuery) return packs;
        return packs.filter((pack) => {
            const room = client.getRoom(pack.roomId);
            const packName = packDisplayName(pack.content, pack.stateKey).toLowerCase();
            const roomName = (room?.name ?? "").toLowerCase();
            return packName.includes(lcQuery) || roomName.includes(lcQuery);
        });
    }, [packs, lcQuery, client]);

    const handleAdd = useCallback(
        async (pack: RoomImagePack): Promise<void> => {
            if (!image) return;
            setBusyKey(packKey(pack));
            setError(null);
            try {
                // Re-fetched and re-decoded (not just reusing the source event's own info/
                // thumbnail verbatim) so this always gets a thumbnail generated under our own
                // rules, regardless of what the original message did or didn't already have.
                const { info } = await addPackImageFromMxcUrl(client, image.mxcUrl);
                await addImageToExistingPack(client, pack.roomId, pack.stateKey, {
                    // Still only a hint: it is cleaned up to a valid shortcode, and numbered if
                    // the pack already has an image under that one.
                    shortcodeHint: shortcode,
                    url: image.mxcUrl,
                    body: description.trim() || undefined,
                    info,
                    usage: choiceToUsage(usage),
                });
                onFinished(true);
            } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
                setBusyKey(null);
            }
        },
        [client, image, shortcode, description, usage, onFinished],
    );

    return (
        <BaseDialog
            title={_t("timeline|context_menu|add_to_pack")}
            className="mx_AddToPackDialog"
            onFinished={() => onFinished(false)}
            fixedWidth={false}
        >
            <Field
                className="mx_AddToPackDialog_search"
                label={_t("timeline|context_menu|add_to_pack_search")}
                value={query}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.currentTarget.value)}
                autoFocus
            />
            <div className="mx_AddToPackDialog_imageFields">
                <Field
                    className="mx_AddToPackDialog_shortcode"
                    label={_t("room_settings|emoji_stickers|shortcode")}
                    value={shortcode}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setShortcode(e.currentTarget.value)}
                    disabled={!image}
                />
                <Field
                    className="mx_AddToPackDialog_usage"
                    element="select"
                    label={_t("room_settings|emoji_stickers|image_usage")}
                    value={usage}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                        setUsage(e.currentTarget.value as UsageChoice)
                    }
                    disabled={!image}
                >
                    {USAGE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {_t(opt.labelKey as Parameters<typeof _t>[0])}
                        </option>
                    ))}
                </Field>
            </div>
            <Field
                className="mx_AddToPackDialog_description"
                label={_t("common|description")}
                value={description}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDescription(e.currentTarget.value)}
                disabled={!image}
            />
            {error && <div className="mx_AddToPackDialog_error">{error}</div>}
            <AutoHideScrollbar className="mx_AutoHideScrollbar mx_AddToPackDialog_list">
                {filteredPacks.length === 0 ? (
                    <div className="mx_AddToPackDialog_empty">
                        {_t("timeline|context_menu|add_to_pack_no_packs")}
                    </div>
                ) : (
                    filteredPacks.map((pack) => {
                        const room = client.getRoom(pack.roomId);
                        const key = packKey(pack);
                        return (
                            <div className="mx_AddToPackDialog_row" key={key}>
                                <PackRowAvatar pack={pack} />
                                <div className="mx_AddToPackDialog_rowInfo">
                                    <span className="mx_AddToPackDialog_rowName">
                                        {packDisplayName(pack.content, pack.stateKey)}
                                    </span>
                                    <span className="mx_AddToPackDialog_rowRoom">{room?.name ?? pack.roomId}</span>
                                </div>
                                <AccessibleButton
                                    kind="primary_outline"
                                    onClick={() => handleAdd(pack)}
                                    disabled={busyKey !== null || !image || !shortcode.trim()}
                                >
                                    {busyKey === key ? <Spinner /> : _t("action|add")}
                                </AccessibleButton>
                            </div>
                        );
                    })
                )}
            </AutoHideScrollbar>
        </BaseDialog>
    );
}

/*
 * MSC2545 (Image Packs) — shared data model and room-state/account-data helpers.
 *
 * A room can hold any number of "packs" via separate `m.room.image_pack` state events (one per
 * state_key - the state_key is otherwise meaningless, just a slot). A user's own favorited packs
 * (ones they want to see everywhere, not just the room that owns them) are recorded as account
 * data under `m.image_pack.rooms`, referencing packs by (roomId, stateKey) pair rather than
 * duplicating their content.
 *
 * MSC2545 has been merged into the spec, so both event types are read under their stable name
 * *and* their old unstable (`im.ponies.*`) name for interop with rooms/clients that haven't
 * migrated, but everything this file itself writes goes out under the stable name only - see
 * ROOM_IMAGE_PACK_EVENT/IMAGE_PACK_ROOMS_EVENT's own doc.
 *
 * Deliberately not part of Haven's own Social app (src/apps/social/) - this applies to every room
 * regardless of Social involvement, so it lives directly alongside the rest of stock Element it
 * extends, the same way other cross-cutting Haven patches do.
 */

import { type MatrixClient, type MatrixEvent, type Room, EventType, MsgType } from "matrix-js-sdk/src/matrix";
import { NamespacedValue } from "matrix-js-sdk/src/NamespacedValue";

import { mayBeAnimated } from "./Image";

/** Stable name wins whenever both exist (NamespacedValue, not UnstableValue) - MSC2545 is merged,
 *  so this is what every write in this file uses; the unstable name is only ever read as a
 *  fallback/merge source for rooms or account data written before a client migrated. */
export const ROOM_IMAGE_PACK_EVENT = new NamespacedValue("m.room.image_pack", "im.ponies.room_emotes");
export const IMAGE_PACK_ROOMS_EVENT = new NamespacedValue("m.image_pack.rooms", "im.ponies.emote_rooms");

export type ImagePackUsage = "emoticon" | "sticker";

/** The same `ImageInfo` shape `m.sticker` events use (MSC2545's own Image Object references it
 *  directly) - carried on a pack image so a sticker send has real dimensions/mimetype/size to put
 *  in its own `info` instead of an empty object.
 *
 *  thumbnail_url/thumbnail_info are the standard Matrix ImageInfo thumbnail fields (the same ones
 *  m.image/m.file already use) - a separate, small, always-static preview image (its own upload,
 *  its own mxc://), generated at upload time for any image worth one (see
 *  EmojiStickersRoomSettingsTab.tsx's own generateThumbnail). Some clients (reported: Element
 *  Classic iOS) fail to render an m.sticker at all when its only image is large/animated and no
 *  thumbnail is offered - this gives them a small fallback to actually display. */
export interface ImagePackImageInfo {
    mimetype?: string;
    size?: number;
    w?: number;
    h?: number;
    thumbnail_url?: string;
    thumbnail_info?: {
        mimetype?: string;
        size?: number;
        w?: number;
        h?: number;
    };
}

export interface ImagePackImage {
    url: string;
    body?: string;
    usage?: ImagePackUsage[];
    info?: ImagePackImageInfo;
}

export interface ImagePackMeta {
    display_name?: string;
    avatar_url?: string;
    usage?: ImagePackUsage[];
    attribution?: string;
}

export interface ImagePackContent {
    pack?: ImagePackMeta;
    images: Record<string, ImagePackImage>;
}

/** A pack, plus the (roomId, stateKey) that identifies exactly which state event it came from -
 *  needed everywhere a pack needs to be written back to, favorited, or told apart from another
 *  pack with the same display name. */
export interface RoomImagePack {
    roomId: string;
    stateKey: string;
    content: ImagePackContent;
}

function isImagePackContent(content: unknown): content is ImagePackContent {
    return !!content && typeof content === "object" && typeof (content as ImagePackContent).images === "object";
}

/** Reads both the stable and unstable state event types and merges them by state_key - a pack
 *  found under the stable type always wins over one with the same state_key under the unstable
 *  type, since that's the normal shape a migrating client produces (same state_key, new type). */
function getAllRoomImagePacksRaw(room: Room): RoomImagePack[] {
    const byStateKey = new Map<string, RoomImagePack>();
    for (const eventType of ROOM_IMAGE_PACK_EVENT.names.slice().reverse()) {
        const events = room.currentState.getStateEvents(eventType) ?? [];
        for (const event of events) {
            const content = event.getContent();
            if (!isImagePackContent(content)) continue;
            byStateKey.set(event.getStateKey() ?? "", {
                roomId: room.roomId,
                stateKey: event.getStateKey() ?? "",
                content,
            });
        }
    }
    return [...byStateKey.values()];
}

/** Every pack currently live in this room that actually has images in it (one per state_key). A
 *  pack "deleted" via deleteRoomImagePack still shows up as an empty images:{} content until the
 *  room's own state genuinely has nothing left under that state_key checked in - Matrix state
 *  can't be un-set, only replaced, so this hides any empty-images pack as gone. Used by the emoji
 *  picker and favorites resolution, where an empty pack is useless. For the room settings
 *  management list, which needs to show a freshly created, still-empty pack so the user can add
 *  images to it, see getRoomImagePacksForManagement. */
export function getRoomImagePacks(room: Room): RoomImagePack[] {
    return getAllRoomImagePacksRaw(room).filter((pack) => Object.keys(pack.content.images).length > 0);
}

/** Every pack currently live in this room, including ones with no images yet - unlike
 *  getRoomImagePacks, this only hides a pack once it's been genuinely deleted (no pack metadata
 *  and no images), so a pack the user just created still shows up here to be edited. */
export function getRoomImagePacksForManagement(room: Room): RoomImagePack[] {
    return getAllRoomImagePacksRaw(room).filter(
        (pack) => !!pack.content.pack || Object.keys(pack.content.images).length > 0,
    );
}

export function packDisplayName(pack: ImagePackContent, fallback: string): string {
    return pack.pack?.display_name?.trim() || fallback;
}

/** Per MSC2545: an image's own `usage` overrides its pack's own default; if neither says
 *  anything, the image counts as usable for both emoji and stickers. */
export function effectiveImageUsage(image: ImagePackImage, pack: ImagePackContent): ImagePackUsage[] {
    if (image.usage?.length) return image.usage;
    if (pack.pack?.usage?.length) return pack.pack.usage;
    return ["emoticon", "sticker"];
}

export function packHasUsage(pack: ImagePackContent, usage: ImagePackUsage): boolean {
    return Object.values(pack.images).some((image) => effectiveImageUsage(image, pack).includes(usage));
}

export interface PackImageEntry {
    shortcode: string;
    image: ImagePackImage;
}

export function imagesForUsage(pack: RoomImagePack, usage: ImagePackUsage): PackImageEntry[] {
    return Object.entries(pack.content.images)
        .filter(([, image]) => effectiveImageUsage(image, pack.content).includes(usage))
        .map(([shortcode, image]) => ({ shortcode, image }));
}

/** True when `userId` can create/edit/delete packs in this room - MSC2545 has no per-pack
 *  permission of its own, just the blanket "can you send this state event type at all" check.
 *  Checked against the stable type only - a room that only grants power for the old unstable type
 *  would be unusual (and unfixable by this client anyway, since it always writes the stable type). */
export function canManageImagePacks(room: Room, userId: string): boolean {
    return room.currentState.maySendStateEvent(ROOM_IMAGE_PACK_EVENT.name, userId);
}

function slugify(name: string): string {
    const slug = name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-+|-+$)/g, "");
    return slug || "pack";
}

/** A fresh, currently-unused state_key for a new pack named `name` in this room. */
export function newPackStateKey(room: Room, name: string): string {
    const base = slugify(name);
    const existing = new Set(getRoomImagePacksForManagement(room).map((p) => p.stateKey));
    if (!existing.has(base)) return base;
    for (let i = 2; ; i++) {
        const candidate = `${base}-${i}`;
        if (!existing.has(candidate)) return candidate;
    }
}

export async function saveRoomImagePack(
    client: MatrixClient,
    roomId: string,
    stateKey: string,
    content: ImagePackContent,
): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await client.sendStateEvent(roomId, ROOM_IMAGE_PACK_EVENT.name as any, content as any, stateKey);
}

/** Matrix state can't be deleted, only replaced - an empty pack (no images, no pack.* metadata)
 *  is this room's own convention for "this pack no longer exists" (see getRoomImagePacks's own
 *  filter, which hides any state_key whose content has gone empty this way). */
export async function deleteRoomImagePack(client: MatrixClient, roomId: string, stateKey: string): Promise<void> {
    await saveRoomImagePack(client, roomId, stateKey, { images: {} });
}

// ---------------------------------------------------------------------------
// Favorite packs (m.image_pack.rooms account data)
// ---------------------------------------------------------------------------

interface EmoteRoomsContent {
    rooms?: Record<string, Record<string, Record<string, never>>>;
}

export interface PackRef {
    roomId: string;
    stateKey: string;
}

/** Merges the stable and unstable account data blobs together (room ID -> state_key set), rather
 *  than picking one - unlike room state's per-state_key "stable wins" merge, there's exactly one
 *  of each of these per user, so if both happen to exist (e.g. a previous session wrote the
 *  unstable name before this client migrated), the safe thing is the union of both sets. */
function getEmoteRoomsContent(client: MatrixClient): EmoteRoomsContent {
    const rooms: NonNullable<EmoteRoomsContent["rooms"]> = {};
    for (const eventType of [IMAGE_PACK_ROOMS_EVENT.altName, IMAGE_PACK_ROOMS_EVENT.name]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const content = client.getAccountData(eventType as any)?.getContent() as EmoteRoomsContent | undefined;
        for (const [roomId, stateKeys] of Object.entries(content?.rooms ?? {})) {
            rooms[roomId] = { ...rooms[roomId], ...stateKeys };
        }
    }
    return { rooms };
}

export function getFavoritePackRefs(client: MatrixClient): PackRef[] {
    const content = getEmoteRoomsContent(client);
    const refs: PackRef[] = [];
    for (const [roomId, stateKeys] of Object.entries(content.rooms ?? {})) {
        for (const stateKey of Object.keys(stateKeys ?? {})) {
            refs.push({ roomId, stateKey });
        }
    }
    return refs;
}

/** Resolves each favorited (roomId, stateKey) ref to its live pack content - silently drops a ref
 *  whose room the user has left, or whose pack was since deleted, rather than showing stale data. */
export function getFavoritePacks(client: MatrixClient): RoomImagePack[] {
    const packs: RoomImagePack[] = [];
    for (const { roomId, stateKey } of getFavoritePackRefs(client)) {
        const room = client.getRoom(roomId);
        if (!room) continue;
        const pack = getAllRoomImagePacksRaw(room).find((p) => p.stateKey === stateKey);
        if (pack && Object.keys(pack.content.images).length > 0) {
            packs.push(pack);
        }
    }
    return packs;
}

export function isPackFavorited(client: MatrixClient, roomId: string, stateKey: string): boolean {
    return !!getEmoteRoomsContent(client).rooms?.[roomId]?.[stateKey];
}

/** This room's own packs usable for `usage`, plus the user's favorited packs usable for `usage` -
 *  a favorited pack that's also this room's own is only included once, as a room pack. The flat
 *  pool of packs behind both the emoji picker's pack categories and the composer's custom-emoji
 *  autocomplete (see EmojiPicker.tsx's buildPackCategories and autocomplete/EmojiProvider.tsx). */
export function getEmoticonPacks(room: Room, usage: ImagePackUsage): RoomImagePack[] {
    const roomPacks = getRoomImagePacks(room).filter((pack) => packHasUsage(pack.content, usage));
    const roomPackKeys = new Set(roomPacks.map((p) => `${p.roomId} ${p.stateKey}`));
    const favoritePacks = getFavoritePacks(room.client).filter(
        (pack) => packHasUsage(pack.content, usage) && !roomPackKeys.has(`${pack.roomId} ${pack.stateKey}`),
    );
    return [...roomPacks, ...favoritePacks];
}

/** Writes the complete favorited-pack set in one call - the caller (the user settings tab) always
 *  builds its full desired set locally first (its own Save-before-apply draft), so this never
 *  needs to merge with what's already there.
 *
 *  Writes to *both* the stable and unstable event types, not just the stable one - getEmoteRoomsContent
 *  (read side) merges the two blobs as a union so that favorites set by an older/other client under the
 *  unstable type still show up. That union is one-directional against removal though: if only the stable
 *  blob were updated, a pack the user just unfavorited would still be listed in the untouched unstable
 *  blob and the union would make it reappear on the next read, even though the checkbox was unticked and
 *  Save was clicked. Keeping both blobs identical on every write is what makes removal actually stick. */
export async function setFavoritePackRefs(client: MatrixClient, refs: PackRef[]): Promise<void> {
    const rooms: NonNullable<EmoteRoomsContent["rooms"]> = {};
    for (const { roomId, stateKey } of refs) {
        rooms[roomId] ??= {};
        rooms[roomId][stateKey] = {};
    }
    await Promise.all(
        [IMAGE_PACK_ROOMS_EVENT.name, IMAGE_PACK_ROOMS_EVENT.altName].map((eventType) =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            client.setAccountData(eventType as any, { rooms } as any),
        ),
    );
}

/** Every pack in every room the user has joined - the pool the user settings "Favorite Packs"
 *  picker lets you choose from (favoriting only makes sense across rooms other than the one a
 *  pack already lives in, but there's no harm including it too). */
export function getAllJoinedRoomPacks(client: MatrixClient): RoomImagePack[] {
    return client.getRooms().flatMap((room) => getRoomImagePacks(room));
}

// ---------------------------------------------------------------------------
// Adding images (upload, or from an already-hosted mxc:// URL) - shared by the room settings
// tab's own pack editor and the "Add to Pack" action on an existing image/sticker message, so
// both go through exactly the same thumbnail-generation rules.
// ---------------------------------------------------------------------------

const THUMBNAIL_MAX_DIM = 256;
/** Below this, an original is already small enough that generating a separate thumbnail for it
 *  isn't worth the extra upload - only animated sources (any size) and larger static ones qualify. */
const THUMBNAIL_WORTH_IT_SIZE = 100 * 1024;

interface DecodedImage {
    w: number;
    h: number;
    thumbnail?: { blob: Blob; w: number; h: number };
}

/** Real width/height so a sticker send later has proper `info` (Element/other clients size
 *  stickers off of it - a `{}` info renders tiny) - see EmojiButton.tsx's own onChooseSticker.
 *  Also generates a small static thumbnail for anything worth one: createImageBitmap decodes only
 *  the first frame of an animated source, which is exactly what a static preview needs. Some
 *  clients (reported: Element Classic iOS) fail to render an m.sticker at all when its only image
 *  is large/animated and no thumbnail_url is offered - see ImagePackImageInfo's own doc.
 *
 *  Takes a Blob rather than specifically a File, so the same logic covers both a real upload and
 *  an already-hosted mxc:// URL fetched back down just to decode it - see addImageFromMxcUrl. */
async function decodeImage(blob: Blob): Promise<DecodedImage | undefined> {
    let bitmap: ImageBitmap;
    try {
        bitmap = await createImageBitmap(blob);
    } catch {
        return undefined;
    }
    const w = bitmap.width;
    const h = bitmap.height;
    if (!mayBeAnimated(blob.type) && blob.size <= THUMBNAIL_WORTH_IT_SIZE) {
        bitmap.close();
        return { w, h };
    }

    const scale = Math.min(1, THUMBNAIL_MAX_DIM / Math.max(w, h));
    const thumbnailW = Math.max(1, Math.round(w * scale));
    const thumbnailH = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = thumbnailW;
    canvas.height = thumbnailH;
    const ctx = canvas.getContext("2d");
    ctx?.drawImage(bitmap, 0, 0, thumbnailW, thumbnailH);
    bitmap.close();
    if (!ctx) return { w, h };

    const thumbnailBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!thumbnailBlob) return { w, h };
    return { w, h, thumbnail: { blob: thumbnailBlob, w: thumbnailW, h: thumbnailH } };
}

async function uploadThumbnailIfAny(
    client: MatrixClient,
    decoded: DecodedImage | undefined,
): Promise<Pick<ImagePackImageInfo, "thumbnail_url" | "thumbnail_info">> {
    if (!decoded?.thumbnail) return {};
    const { content_uri: thumbnailUrl } = await client.uploadContent(decoded.thumbnail.blob);
    return {
        thumbnail_url: thumbnailUrl,
        thumbnail_info: {
            mimetype: "image/png",
            size: decoded.thumbnail.blob.size,
            w: decoded.thumbnail.w,
            h: decoded.thumbnail.h,
        },
    };
}

export async function uploadPackImage(
    client: MatrixClient,
    file: File,
): Promise<{ mxcUrl: string; info: ImagePackImageInfo }> {
    const [{ content_uri: mxcUrl }, decoded] = await Promise.all([client.uploadContent(file), decodeImage(file)]);
    const info: ImagePackImageInfo = {
        mimetype: file.type || undefined,
        size: file.size,
        w: decoded?.w,
        h: decoded?.h,
        ...(await uploadThumbnailIfAny(client, decoded)),
    };
    return { mxcUrl, info };
}

const MXC_URL_PATTERN = /^mxc:\/\/[^/]+\/[^/]+$/;

/** The "paste/reuse an mxc:// URL instead of uploading" path - the image already exists on the
 *  media repo, so unlike uploadPackImage there's no re-upload of the main image, just a fetch to
 *  decode its own dimensions/mimetype/size (and generate+upload a thumbnail if warranted) the
 *  same way a freshly uploaded file would get. Used both by the room settings tab's own "add by
 *  URL" field and by "Add to Pack" (reusing an existing message's own mxc:// url verbatim). */
export async function addPackImageFromMxcUrl(
    client: MatrixClient,
    mxcUrl: string,
): Promise<{ mxcUrl: string; info: ImagePackImageInfo }> {
    if (!MXC_URL_PATTERN.test(mxcUrl)) {
        throw new Error("Not a valid mxc:// URL");
    }
    const httpUrl = client.mxcUrlToHttp(mxcUrl);
    if (!httpUrl) {
        throw new Error("Could not resolve that mxc:// URL");
    }
    const res = await fetch(httpUrl);
    if (!res.ok) {
        throw new Error(`Server returned ${res.status} fetching that mxc:// URL`);
    }
    const blob = await res.blob();
    const decoded = await decodeImage(blob);
    const info: ImagePackImageInfo = {
        mimetype: blob.type || undefined,
        size: blob.size,
        w: decoded?.w,
        h: decoded?.h,
        ...(await uploadThumbnailIfAny(client, decoded)),
    };
    return { mxcUrl, info };
}

/** Strips a trailing file extension (if any) and replaces anything outside the MSC2545 shortcode
 *  grammar with underscores - a starting point derived from a filename/body/media ID, always still
 *  freely editable afterward, never assumed to already be a valid final shortcode. */
export function sanitizeShortcode(text: string): string {
    return text.replace(/\.[^./]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "_") || "image";
}

/** Derives a starting shortcode from an mxc:// URL's own media ID, for a source with no
 *  filename/body text to derive one from instead. */
export function shortcodeFromMxcUrl(mxcUrl: string): string {
    return sanitizeShortcode(mxcUrl.split("/").pop() ?? "");
}

/** Resolves the avatar to show for a pack, in order: (1) the pack's own explicit avatar_url, (2)
 *  the first image in the pack, and finally (3), if the pack has no images either, the pack's
 *  source room's avatar (MSC2545's own "defaults to the room's avatar" fallback is the last
 *  resort here, not the second choice, per explicit user direction) - so a pack browsing UI never
 *  has to show a bare placeholder for a pack that actually has images in it. Used everywhere a
 *  pack's avatar is shown for display purposes (the emoji picker's category rail, the room/user/
 *  space settings pack lists and pack editor, and the "Add to Pack" dialog) - not for what a pack
 *  editor treats as the pack's own saved avatar value, which must stay undefined until the user
 *  explicitly sets one. */
export function getPackAvatarMxc(pack: RoomImagePack, client: MatrixClient): string | undefined {
    if (pack.content.pack?.avatar_url) return pack.content.pack.avatar_url;
    const firstImage = Object.values(pack.content.images)[0]?.url;
    if (firstImage) return firstImage;
    return client.getRoom(pack.roomId)?.getMxcAvatarUrl() ?? undefined;
}

/** Whether `mxEvent` is something "Add to Pack" can offer: an m.sticker, or an m.room.message with
 *  msgtype m.image - and, either way, unencrypted. Image packs are never encrypted (MSC2545's own
 *  Security Considerations section is explicit about this), so an E2EE room's encrypted image
 *  (content.file, not a plain content.url) can't be added at all - checking for a string
 *  content.url here is what actually excludes that case, not a separate check. */
export function getPackableImageFromEvent(mxEvent: MatrixEvent): { mxcUrl: string; body?: string } | undefined {
    const content = mxEvent.getContent();
    const type = mxEvent.getType();
    const isPackableType =
        type === EventType.Sticker || (type === EventType.RoomMessage && content.msgtype === MsgType.Image);
    if (!isPackableType || typeof content.url !== "string") return undefined;
    return { mxcUrl: content.url, body: typeof content.body === "string" ? content.body : undefined };
}

/** Every pack, across every room the user has joined, that they can manage (see
 *  canManageImagePacks) - including still-empty ones, since adding the first image to a pack you
 *  just created is a completely reasonable thing to want to do. The pool "Add to Pack" picks from. */
export function getManageableImagePacks(client: MatrixClient): RoomImagePack[] {
    const userId = client.getSafeUserId();
    return client.getRooms().flatMap((room) => (canManageImagePacks(room, userId) ? getRoomImagePacksForManagement(room) : []));
}

function uniqueShortcode(base: string, existing: ReadonlySet<string>): string {
    if (!existing.has(base)) return base;
    for (let i = 2; ; i++) {
        const candidate = `${base}-${i}`;
        if (!existing.has(candidate)) return candidate;
    }
}

/** Adds one image to an already-existing pack, writing straight through (no draft/Save step - this
 *  is the "Add to Pack" one-shot action from an existing message, not the full pack editor). Usage
 *  is always copied from the pack's own default, per how this was specced - a single image being
 *  added this way has no independent usage override of its own. */
export async function addImageToExistingPack(
    client: MatrixClient,
    roomId: string,
    stateKey: string,
    newImage: { shortcodeHint: string; url: string; body?: string; info?: ImagePackImageInfo },
): Promise<void> {
    const room = client.getRoom(roomId);
    if (!room) throw new Error("You're not in that pack's room");
    const pack = getRoomImagePacksForManagement(room).find((p) => p.stateKey === stateKey);
    if (!pack) throw new Error("That pack no longer exists");

    const usage: ImagePackUsage[] = pack.content.pack?.usage?.length ? pack.content.pack.usage : ["emoticon", "sticker"];
    const shortcode = uniqueShortcode(
        sanitizeShortcode(newImage.shortcodeHint),
        new Set(Object.keys(pack.content.images)),
    );

    const content: ImagePackContent = {
        ...pack.content,
        images: {
            ...pack.content.images,
            [shortcode]: { url: newImage.url, body: newImage.body, usage, info: newImage.info },
        },
    };
    await saveRoomImagePack(client, roomId, stateKey, content);
}

/*
 * Social Overlay - postEdit
 *
 * Editing a post re-opens it in the pop-up post composer as though it were about to be sent again:
 * its text back as composer text (mentions as the "@user:server" the composer turns into pills),
 * and its media, location or voice message staged in the attachment shelf. Sending then replaces
 * the post with a standard m.replace edit whose m.new_content is built the same way a new post's
 * content is (see social-actions.ts's sendPost), so the text, the media, or both can change.
 *
 * Fields that describe what the post is rather than what it says - a quote post's repost
 * relation, a cross-posted reply's link to the reply - are kept from the original as they are.
 */

import {
    type MatrixClient,
    MatrixEvent,
    type Room,
    EventType,
    MsgType,
    RelationType,
} from "matrix-js-sdk/src/matrix";

import { parseEvent } from "../../../../element-web/apps/web/src/editor/deserialize";
import { PartCreator, Type, type Part } from "../../../../element-web/apps/web/src/editor/parts";
import { parsePermalink } from "../../../../element-web/apps/web/src/utils/permalinks/Permalinks";
import {
    MSC4501_BODY_KEY,
    MSC4501_EVENT_POST,
    MSC4501_FORMATTED_BODY_KEY,
    MSC4501_RELATES_TO_KEY,
    MSC4501_REL_TYPE_REPOST,
} from "./room-classifier";
import { attachMentions } from "./mentionPills";
import { applyMarkdownAndEmote } from "./socialSlashCommands";

export type StagedMediaKind = "image" | "video" | "audio" | "voice" | "file" | "location";

/**
 * Media already uploaded (or a location) that an edited post carries over without uploading
 * anything again: the post's own media when the editor opens, or a location/voice message picked
 * while editing.
 */
export interface StagedMedia {
    kind: StagedMediaKind;
    /** The media's own content fields (msgtype, url/file, info, geo_uri, ...), without any text. */
    content: Record<string, unknown>;
    /** The body to send when there's no caption, e.g. the file name. */
    defaultBody: string;
    /** What the shelf tile shows. */
    name: string;
}

const VOICE_KEY = "org.matrix.msc3245.voice";
const VOICE_DEFAULT_BODY = "Voice message";

const MEDIA_MSGTYPES = new Set<string>([MsgType.Image, MsgType.Video, MsgType.Audio, MsgType.File, MsgType.Location]);
const EDITABLE_MSGTYPES = new Set<string>([MsgType.Text, MsgType.Emote, ...MEDIA_MSGTYPES]);

/** The post's text. These are rebuilt from the composer, never carried over. */
const TEXT_KEYS = new Set([
    "body",
    "format",
    "formatted_body",
    "m.mentions",
    "m.relates_to",
    "m.new_content",
    // The extensible-events copy of body that location and voice messages carry.
    "org.matrix.msc1767.text",
    MSC4501_BODY_KEY,
    MSC4501_FORMATTED_BODY_KEY,
    // A bridge's "my first line is a header" flag. It would hide the first line of the new text.
    "software.haven.remove_header",
]);

/** Fields kept from the original as they are: MSC4501's own relations (quote post, cross-posted reply). */
function isPreservedKey(key: string): boolean {
    return key.startsWith("org.matrix.msc4501.social.") && !TEXT_KEYS.has(key);
}

function isBoost(content: Record<string, any>): boolean {
    const relation = content[MSC4501_RELATES_TO_KEY];
    if (relation?.rel_type !== MSC4501_REL_TYPE_REPOST) return false;
    if (relation.content_inline) return true;
    const permalink = typeof content.body === "string" ? parsePermalink(content.body.trim()) : null;
    return !!permalink && permalink.eventId === relation.event_id;
}

/**
 * Whether `event` is one of the user's own posts or replies that the post editor can edit: a text
 * or media message (not a poll, sticker, or a plain boost, whose body is only a link to the post
 * it reposts), already sent, not deleted, and not itself an edit.
 */
export function canEditPost(client: MatrixClient, event: MatrixEvent): boolean {
    if (event.getSender() !== client.getUserId()) return false;
    if (event.status !== null || event.isRedacted() || event.isRelation(RelationType.Replace)) return false;
    const type = event.getType();
    if (type !== EventType.RoomMessage && type !== MSC4501_EVENT_POST) return false;
    const content = event.getContent();
    if (!EDITABLE_MSGTYPES.has(content.msgtype ?? "")) return false;
    return !isBoost(content);
}

function mediaKind(content: Record<string, any>): StagedMediaKind {
    switch (content.msgtype) {
        case MsgType.Image:
            return "image";
        case MsgType.Video:
            return "video";
        case MsgType.Audio:
            return content[VOICE_KEY] !== undefined ? "voice" : "audio";
        case MsgType.Location:
            return "location";
        default:
            return "file";
    }
}

/** Splits media content (a post's, or a location/voice message's) into the media and its caption. */
export function splitMedia(content: Record<string, any>): { media: StagedMedia; caption: string | null } {
    const kind = mediaKind(content);
    const media: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(content)) {
        if (!TEXT_KEYS.has(key) && !isPreservedKey(key)) media[key] = value;
    }
    const body = typeof content.body === "string" ? content.body : "";
    let defaultBody: string;
    let hasCaption: boolean;
    if (kind === "location") {
        // Stock's location body names the coordinates ("Location geo:... at ...").
        const geoUri = typeof content.geo_uri === "string" ? content.geo_uri : "";
        hasCaption = !!body && !!geoUri && !body.includes(geoUri);
        defaultBody = hasCaption ? `Location ${geoUri}` : body;
    } else if (kind === "voice") {
        hasCaption = !!body && body !== VOICE_DEFAULT_BODY;
        defaultBody = VOICE_DEFAULT_BODY;
    } else {
        const filename = typeof content.filename === "string" ? content.filename : undefined;
        // Without a separate filename, body is the file name (stock's captionless upload).
        hasCaption = filename !== undefined ? !!body && body !== filename : false;
        defaultBody = filename ?? (body || "attachment");
    }
    const name =
        kind === "location" ? "Location" : kind === "voice" ? VOICE_DEFAULT_BODY : (content.filename ?? defaultBody);
    return { media: { kind, content: media, defaultBody, name }, caption: hasCaption ? body : null };
}

function partText(part: Part): string {
    switch (part.type) {
        case Type.UserPill:
        case Type.RoomPill:
            // The composer sends "@user:server" and "#alias:server" as pills.
            return (part as Part & { resourceId: string }).resourceId;
        case Type.AtRoomPill:
            return "@room";
        case Type.Newline:
            return "\n";
        default:
            return part.text;
    }
}

/**
 * The composer text that sends `content`'s text again: Markdown-escaped where needed and with
 * pills back as user IDs and aliases, the same way stock's message editor reads a message back.
 */
export function composerTextFor(client: MatrixClient, room: Room, content: Record<string, any>): string {
    const textOnly = {
        getContent: () => ({
            msgtype: content.msgtype,
            body: content.body,
            format: content.format,
            formatted_body: content.formatted_body,
        }),
        replyEventId: undefined,
    } as unknown as MatrixEvent;
    return parseEvent(textOnly, new PartCreator(room, client)).map(partText).join("");
}

/** What the post editor opens with for `event`. */
export function editDraftFor(
    client: MatrixClient,
    room: Room,
    event: MatrixEvent,
): { body: string; media: StagedMedia | null } {
    const content = event.getContent();
    if (!MEDIA_MSGTYPES.has(content.msgtype ?? "")) {
        return { body: composerTextFor(client, room, content), media: null };
    }
    const { media, caption } = splitMedia(content);
    if (caption === null) return { body: "", media };
    return { body: composerTextFor(client, room, { ...content, body: caption }), media };
}

/** `media` with `caption` as its body: the same formatting a new post's caption gets. */
function withCaption(
    client: MatrixClient,
    roomId: string,
    media: StagedMedia,
    caption: string,
): Record<string, unknown> {
    const content: Record<string, unknown> = { ...media.content, body: media.defaultBody };
    const trimmed = caption.trim();
    if (!trimmed) return content;
    const formatted = applyMarkdownAndEmote(trimmed, client, roomId);
    content.body = formatted.body;
    if (formatted.formattedBody) {
        content.format = "org.matrix.custom.html";
        content.formatted_body = formatted.formattedBody;
    }
    return content;
}

/**
 * The edited post's full new content. `upload` builds content for a newly picked file (social-
 * actions.ts's buildMediaMessageContent), passed in so this stays free of upload code.
 */
export async function buildEditedContent(
    client: MatrixClient,
    roomId: string,
    original: MatrixEvent,
    draft: { body: string; file?: File; media?: StagedMedia | null },
    upload: (file: File, caption: string) => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
    let content: Record<string, unknown>;
    if (draft.file) {
        content = await upload(draft.file, draft.body);
    } else if (draft.media) {
        content = withCaption(client, roomId, draft.media, draft.body);
    } else {
        const formatted = applyMarkdownAndEmote(draft.body.trim(), client, roomId);
        content = { body: formatted.body, msgtype: formatted.isEmote ? MsgType.Emote : MsgType.Text };
        if (formatted.formattedBody) {
            content.format = "org.matrix.custom.html";
            content.formatted_body = formatted.formattedBody;
        }
    }
    attachMentions(content, client.getUserId());
    for (const [key, value] of Object.entries(original.getContent())) {
        if (isPreservedKey(key)) content[key] = value;
    }
    return content;
}

/**
 * The m.replace event content for replacing `original` with `newContent`. Its own m.mentions
 * lists only users the edit newly mentions, so an edit doesn't notify everyone again.
 */
export function makeEditContent(original: MatrixEvent, newContent: Record<string, any>): Record<string, unknown> {
    const edit: Record<string, unknown> = { msgtype: newContent.msgtype, body: `* ${newContent.body}` };
    if (newContent.formatted_body) {
        edit.format = "org.matrix.custom.html";
        edit.formatted_body = `* ${newContent.formatted_body}`;
    }
    const before: string[] = original.getContent()["m.mentions"]?.user_ids ?? [];
    const after: string[] = newContent["m.mentions"]?.user_ids ?? [];
    const added = after.filter((id) => !before.includes(id));
    edit["m.mentions"] = added.length ? { user_ids: added } : {};
    edit["m.new_content"] = newContent;
    edit["m.relates_to"] = { rel_type: RelationType.Replace, event_id: original.getId() };
    return edit;
}

/**
 * Sends the edit, in the same thread as the original when it's a reply, and applies it to
 * `original` right away. The SDK files an edit of a post that has replies under its thread and
 * only applies it to the Feed's copy of the post later (confirmed live: the post kept showing its
 * old content until the view was reopened), so this applies it to the copy that's on screen.
 */
export async function sendPostEdit(
    client: MatrixClient,
    original: MatrixEvent,
    newContent: Record<string, unknown>,
): Promise<void> {
    const roomId = original.getRoomId()!;
    const threadRootId = original.threadRootId;
    const threadId = threadRootId && threadRootId !== original.getId() ? threadRootId : null;
    const content = makeEditContent(original, newContent);
    const { event_id: editId } = await client.sendEvent(roomId, threadId, original.getType() as any, content as any);
    if (original.replacingEventId() === editId) return;
    const edit =
        client.getRoom(roomId)?.findEventById(editId) ??
        new MatrixEvent({
            type: original.getType(),
            event_id: editId,
            room_id: roomId,
            sender: client.getUserId() ?? undefined,
            origin_server_ts: Date.now(),
            content,
        });
    original.makeReplaced(edit);
}

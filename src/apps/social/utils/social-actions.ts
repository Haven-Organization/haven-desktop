/*
 * Social Overlay — Action Helpers
 *
 * All Matrix calls go through the existing MatrixClientPeg singleton.
 * No new client instances are created here.
 */

import { type MatrixClient, EventType, JoinRule, KnownMembership, Method, ReceiptType } from "matrix-js-sdk/src/matrix";

import defaultDispatcher from "../../../../element-web/apps/web/src/dispatcher/dispatcher";
import SettingsStore from "../../../../element-web/apps/web/src/settings/SettingsStore";
import {
    uploadFile,
    infoForImageFile,
    infoForAudioFile,
    infoForVideoFile,
} from "../../../../element-web/apps/web/src/ContentMessages";
import {
    MSC4501_EVENT_POST,
    MSC4501_PROFILE_ROOM_KEY,
    MSC4501_RELATES_TO_KEY,
    MSC4501_REL_TYPE_REPOST,
    MSC4501_REL_TYPE_REPLY,
    ROOM_BANNER_EVENT_TYPE,
} from "./room-classifier";
import { markPendingLeave } from "./pendingRoomLeave";
import { resolveThreadRootId } from "./thread-relations";

/** Dispatched whenever the user's MSC4501 profile_room_id link is set or cleared, so any mounted
 *  component with its own cached copy (e.g. useProfileRoomLink) knows to re-fetch it — needed
 *  because the setter is often called from a Modal.createDialog tree (Room Settings), which is a
 *  separate React root with no shared props/context back to SocialHomeView. */
export const PROFILE_ROOM_LINK_CHANGED = "social_profile_room_link_changed";

// ---------------------------------------------------------------------------
// Room editing helpers
// ---------------------------------------------------------------------------

export async function updateRoomName(client: MatrixClient, roomId: string, name: string): Promise<void> {
    await client.sendStateEvent(roomId, EventType.RoomName, { name }, "");
}

export async function updateRoomAvatar(client: MatrixClient, roomId: string, file: File): Promise<void> {
    const { content_uri: url } = await client.uploadContent(file);
    await client.sendStateEvent(roomId, EventType.RoomAvatar, { url }, "");
}

export async function updateRoomBanner(client: MatrixClient, roomId: string, file: File): Promise<void> {
    const { content_uri: url } = await client.uploadContent(file);
    // ROOM_BANNER_EVENT_TYPE is a Haven-specific event type, not part of matrix-js-sdk's own
    // StateEvents map, so sendStateEvent's content type can't be inferred from it.
    await client.sendStateEvent(roomId, ROOM_BANNER_EVENT_TYPE as any, { url, info: { mimetype: file.type } }, "");
}

export async function removeRoomBanner(client: MatrixClient, roomId: string): Promise<void> {
    await client.sendStateEvent(roomId, ROOM_BANNER_EVENT_TYPE as any, {}, "");
}

// ---------------------------------------------------------------------------
// MSC4501 — profile room pointer (depends on MSC4133 for the profile-field mechanism itself)
// ---------------------------------------------------------------------------

/** Low-level PUT, shared by setProfileRoomLink and clearProfileRoomLink's fallback — throws on
 *  failure instead of swallowing, so callers that need to know whether it actually worked can. */
async function putProfileRoomLink(client: MatrixClient, roomId: string): Promise<void> {
    // setProfileInfo's TS overloads only know about "avatar_url"/"displayname", but the endpoint
    // itself (PUT /profile/$userId/$info) is generic — content must be `{ [info]: value }`, same
    // shape as the two built-in overloads use, just keyed by our own MSC4501 field name.
    const info = MSC4501_PROFILE_ROOM_KEY as unknown as "displayname";
    const content = { [MSC4501_PROFILE_ROOM_KEY]: roomId } as unknown as { displayname: string };
    await client.setProfileInfo(info, content);
}

/** Best-effort — used from room creation, where a failure to write this secondary metadata
 *  shouldn't block the room itself from being created. */
export async function setProfileRoomLink(client: MatrixClient, roomId: string): Promise<void> {
    try {
        await putProfileRoomLink(client, roomId);
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error("setProfileRoomLink failed (server may not support MSC4133 profile writes)", err);
    }
    defaultDispatcher.dispatch({ action: PROFILE_ROOM_LINK_CHANGED });
}

/** Removes the MSC4501 profile_room_id pointer from the user's own profile — no SDK wrapper exists
 *  for DELETE on a per-key profile field, so this calls the endpoint directly via client.http.
 *  Unlike setProfileRoomLink, this one rethrows if both the DELETE and its PUT-empty-string
 *  fallback fail, so the caller (the Unlink Profile button) can show the user a real error instead
 *  of silently no-oping — that silence was exactly why a previous attempt at this looked broken. */
export async function clearProfileRoomLink(client: MatrixClient): Promise<void> {
    const path = `/profile/${encodeURIComponent(client.getSafeUserId())}/${encodeURIComponent(MSC4501_PROFILE_ROOM_KEY)}`;
    try {
        await client.http.authedRequest(Method.Delete, path);
    } catch (deleteErr) {
        // eslint-disable-next-line no-console
        console.error("clearProfileRoomLink: DELETE failed, falling back to PUT empty string", deleteErr);
        try {
            await putProfileRoomLink(client, "");
        } catch (putErr) {
            // eslint-disable-next-line no-console
            console.error("clearProfileRoomLink: fallback PUT also failed", putErr);
            throw putErr; // nothing actually changed — don't dispatch PROFILE_ROOM_LINK_CHANGED.
        }
    }
    defaultDispatcher.dispatch({ action: PROFILE_ROOM_LINK_CHANGED });
}

/** Reads the user's MSC4501 profile_room_id link directly from their account profile (not from any
 *  locally-cached state) — `null` once confirmed unset (never linked, or `GET` 404s because the
 *  key was deleted), never throws.
 *
 *  Fetches the *whole* profile (no `info` filter) rather than requesting this one key via
 *  `getProfileInfo(userId, key)` — the latter silently came back empty for this custom
 *  MSC4133-style field on every user except yourself. ViewProfileSource.tsx's dev-mode "View
 *  Source" dialog (which does show the field correctly for any user) fetches the unfiltered
 *  profile the same way this now does — matching the known-working path instead of the
 *  single-field one Synapse apparently doesn't extend to arbitrary keys. */
export async function getProfileRoomLink(client: MatrixClient, userId: string): Promise<string | null> {
    try {
        const profile = (await client.getProfileInfo(userId)) as unknown as Record<string, string>;
        return profile[MSC4501_PROFILE_ROOM_KEY] || null;
    } catch {
        return null;
    }
}

/** Matches both the legacy !localpart:server.name room ID format and room version 12+'s
 *  hash-based !opaque form with no server name suffix (the same change event IDs already went
 *  through) — the trailing :server part is optional, not required. */
export const PROFILE_ROOM_ID_PATTERN = /^![^\s:]+(:[^\s]+)?$/;

export type ProfileRoomResolution =
    /** client.getRoom(profileRoomId) now returns a usable Room — already joined, or just peeked. */
    | { kind: "room" }
    /** Not joined and not (fully) peekable, but enough of the room's public summary came back to
     *  show a lightweight preview with a Follow/Request Follow call to action. roomType is read
     *  from the same m.room.create "type" field getRoomType() reads for an already-loaded Room
     *  (MSC3827 exposes it on room summaries too), so SocialProfilePreview can tell a group from a
     *  profile room before ever joining it, for group-appropriate button wording (Join/Leave vs
     *  Follow/Unfollow). */
    | {
          kind: "preview";
          joinRule: "public" | "knock";
          name?: string;
          avatarUrl?: string;
          topic?: string;
          roomType?: string;
      }
    /** Invite-only/restricted, or the summary request was refused outright. */
    | { kind: "private" }
    /** profile_room_id missing, empty, or not shaped like a room ID at all. */
    | { kind: "invalid" };

/**
 * Resolves what should be shown for a user's linked MSC4501 profile room when the viewer isn't
 * already a member of it. Tries, in order: local room (already joined) -> the room's public
 * summary (MSC3266, no join required) -> a full peek of its timeline/state if the summary says
 * it's public and world-readable (reusing SocialRoomView wholesale, same as an already-joined
 * room, once that succeeds) -> a summary-only preview for public-but-not-world-readable or
 * knockable rooms -> "private" for anything else (invite-only, restricted, or a summary request
 * the server refused). Never throws.
 */
export async function resolveProfileRoom(
    client: MatrixClient,
    profileRoomId: string | null | undefined,
): Promise<ProfileRoomResolution> {
    if (!profileRoomId || !PROFILE_ROOM_ID_PATTERN.test(profileRoomId)) return { kind: "invalid" };
    // client.getRoom() returning non-null only means the SDK has *a* Room object cached for this
    // ID - matrix-js-sdk keeps left-room objects around locally rather than evicting them the
    // instant you leave, so this used to treat "I left this room a moment ago" the same as "I'm
    // still a member", routing straight into the full joined-room view (viewRoom -> SocialRoomView)
    // instead of falling through to the summary/preview path below meant for non-members. Checking
    // actual membership here is what makes re-visiting a profile after unfollowing it correctly
    // show the Follow/preview state instead of looking like you're still following.
    const cachedRoom = client.getRoom(profileRoomId);
    if (cachedRoom?.getMyMembership() === KnownMembership.Join) return { kind: "room" };

    let summary;
    try {
        summary = await client.getRoomSummary(profileRoomId);
    } catch {
        return { kind: "private" };
    }
    // RoomSummary types join_rule narrowly as Knock | Public (its origin, IPublicRoomsChunkRoom,
    // predates knock_restricted etc. in the spec) — widen to what the server can actually send.
    const joinRule = summary.join_rule as unknown as string | undefined;

    if (joinRule === JoinRule.Public) {
        if (summary.world_readable) {
            try {
                await client.peekInRoom(profileRoomId);
                return { kind: "room" };
            } catch {
                // Summary said world-readable but the peek itself was refused/failed — fall back
                // to the lightweight summary-only preview below rather than "private", since the
                // room genuinely is public.
            }
        }
        return {
            kind: "preview",
            joinRule: "public",
            name: summary.name,
            avatarUrl: summary.avatar_url,
            topic: summary.topic,
            roomType: summary.room_type,
        };
    }

    if (joinRule === JoinRule.Knock || joinRule === "knock_restricted") {
        return {
            kind: "preview",
            joinRule: "knock",
            name: summary.name,
            avatarUrl: summary.avatar_url,
            topic: summary.topic,
            roomType: summary.room_type,
        };
    }

    return { kind: "private" };
}

// ---------------------------------------------------------------------------
// Read receipts
// ---------------------------------------------------------------------------

/**
 * Marks a post as read — sent whenever the user engages with it (opening it, replying, reposting/
 * quote-posting, or reacting), per MSC4501's expectation that these interactions imply the post was
 * seen even if it never scrolled through the timeline naturally (e.g. reached via a matrix.to link
 * or already scrolled past before the interaction happened). Respects Preferences > Presence > "Send
 * read receipts" the same way stock Element does (see notifications.ts's clearRoomNotification) —
 * off sends ReceiptType.ReadPrivate, a receipt visible only to the sending user's own other devices,
 * never broadcast to the room. Best-effort: the event may not be one the SDK has locally (theoretically
 * possible if it's since fallen out of the timeline window), and a receipt failure should never block
 * the real action that triggered it.
 */
export async function sendPostReadReceipt(client: MatrixClient, roomId: string, eventId: string): Promise<void> {
    const event = client.getRoom(roomId)?.findEventById(eventId);
    if (!event) return;
    const receiptType = SettingsStore.getValue("sendReadReceipts", roomId) ? ReceiptType.Read : ReceiptType.ReadPrivate;
    try {
        await client.sendReadReceipt(event, receiptType);
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error("sendPostReadReceipt failed", err);
    }
}

// ---------------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------------

/**
 * Uploads `file` and builds a standard media message content object (msgtype m.image/m.video/
 * m.audio/m.file, chosen by the file's own mime type) - the same shape a stock Element upload
 * sends, not a Social-only field other clients/bridges can't render. `caption` becomes `body`
 * (falling back to the real filename when empty, matching stock's own captionless-upload
 * convention) - `filename` is always set explicitly alongside it, since `body` holding a caption
 * instead of the real name is exactly the case `filename` exists to cover.
 *
 * Reuses `infoForImageFile`/`infoForAudioFile`/`infoForVideoFile` (exported from stock
 * ContentMessages.ts - see the "haven apps-framework patch" comments there) for thumbnail/
 * blurhash/duration generation and `uploadFile` for the actual upload, so attachments sent this
 * way get identical treatment (including E2EE for encrypted rooms) to the stock Upload button -
 * this function is really just `ContentMessages.sendContentToRoom`'s own content-building body,
 * called directly instead of through the immediate-send pipeline, since Social defers the actual
 * upload until the whole post (caption + attachment) is sent together as one call.
 */
export async function buildMediaMessageContent(
    client: MatrixClient,
    roomId: string,
    file: File,
    caption: string,
): Promise<Record<string, unknown>> {
    const filename = file.name || "attachment";
    const info: Record<string, unknown> = { size: file.size };
    if (file.type) info.mimetype = file.type;
    const content: Record<string, unknown> = {
        body: caption.trim() || filename,
        filename,
        msgtype: "m.file",
        info,
    };

    try {
        if (file.type.startsWith("image/")) {
            content.msgtype = "m.image";
            Object.assign(info, await infoForImageFile(client, roomId, file));
        } else if (file.type.startsWith("audio/")) {
            content.msgtype = "m.audio";
            Object.assign(info, await infoForAudioFile(file));
        } else if (file.type.startsWith("video/")) {
            content.msgtype = "m.video";
            Object.assign(info, await infoForVideoFile(client, roomId, file));
        }
    } catch {
        // Thumbnailing/metadata read failed - fall back to a plain file attachment rather than
        // aborting the whole post, same graceful degrade stock's own sendContentToRoom uses.
        content.msgtype = "m.file";
    }

    const result = await uploadFile(client, roomId, file);
    if (result.file) content.file = result.file;
    if (result.url) content.url = result.url;
    return content;
}

/**
 * The event type to send for any new post/reply/repost. Defaults to a plain m.room.message per
 * MSC4501's Phase 1 rollout plan; when the "feature_msc4501_native_post_type" lab is enabled,
 * sends the native org.matrix.msc4501.social.post event type instead (MSC4501's Phase 2 behavior).
 */
function currentPostEventType(): string {
    return SettingsStore.getValue("feature_msc4501_native_post_type") ? MSC4501_EVENT_POST : "m.room.message";
}

/**
 * Sends a social post — see currentPostEventType() for which event type.
 */
export async function sendPost(
    client: MatrixClient,
    roomId: string,
    body: string,
    formattedBody?: string,
    file?: File,
    isEmote?: boolean,
): Promise<void> {
    const msgtype = isEmote ? "m.emote" : "m.text";
    const content: Record<string, unknown> = file
        ? await buildMediaMessageContent(client, roomId, file, body)
        : formattedBody
          ? { body, msgtype, format: "org.matrix.custom.html", formatted_body: formattedBody }
          : { body, msgtype, format: "plain" };
    await client.sendEvent(roomId, currentPostEventType() as any, content);
}

/**
 * Sends a threaded reply — see currentPostEventType() for which event type.
 * Follows the standard Matrix thread relation (m.thread) and includes m.in_reply_to.
 *
 * formattedBody/isEmote mirror sendPost's own params - the caller is expected to run typed text
 * through processSlashCommand (socialSlashCommands.ts) first, same as every top-level post
 * composer already does, rather than passing raw composer text straight through. Both are ignored
 * when file is set, same reasoning as sendPost's own file branch (a media caption doesn't carry
 * rich HTML formatting).
 */
export async function sendComment(
    client: MatrixClient,
    roomId: string,
    body: string,
    parentEventId: string,
    file?: File,
    formattedBody?: string,
    isEmote?: boolean,
): Promise<void> {
    const room = client.getRoom(roomId);
    // rel_type: m.thread's own event_id must always be the thread's single, true, flat root -
    // never the immediate parent - regardless of how deep this reply actually is (see
    // resolveThreadRootId's own comment: Synapse 400s "Cannot start threads from an event with a
    // relation" if it isn't). m.in_reply_to is the only field that varies with depth.
    const rootEventId = room ? await resolveThreadRootId(client, room, parentEventId) : parentEventId;

    // Ensure a Thread object exists for the post being replied to *before* sending. Stock Element
    // always has one by this point (opening the thread panel creates it), but Social's reply flow
    // never goes through that path. Without it, matrix-js-sdk's handleRemoteEcho (models/room.ts)
    // — which runs when the server confirms this event and replaces the local echo — resolves
    // `this.getThread(threadId)` to null and silently drops the confirmed event: it's a
    // thread-relation message so it doesn't live in the main timeline, and with no thread object to
    // route it into, it isn't added anywhere at all. The reply is visible only as long as its local
    // echo exists, then vanishes the moment the server confirms it. createThread is idempotent
    // (harmless if a thread already exists from an earlier reply). Keyed by rootEventId, not
    // parentEventId, to match the thread id the event being sent below will actually carry.
    if (room && !room.getThread(rootEventId)) {
        room.createThread(rootEventId, room.findEventById(rootEventId), [], false);
    }

    const msgtype = isEmote ? "m.emote" : "m.text";
    const content: Record<string, unknown> = file
        ? await buildMediaMessageContent(client, roomId, file, body)
        : formattedBody
          ? { body, msgtype, format: "org.matrix.custom.html", formatted_body: formattedBody }
          : { body, msgtype };
    content["m.relates_to"] = {
        rel_type: "m.thread",
        event_id: rootEventId,
        is_falling_back: false,
        "m.in_reply_to": {
            event_id: parentEventId,
        },
    };
    await client.sendEvent(roomId, currentPostEventType() as any, content);
    void sendPostReadReceipt(client, roomId, parentEventId);

    // Best-effort cross-post into the replier's own profile feed, per MSC4501's "Cross-posting a
    // reply to your profile" — never blocks or fails the real in-thread reply above, which has
    // already sent successfully by this point regardless of what happens here.
    try {
        await crossPostReply(client, roomId, parentEventId, body, file ? undefined : formattedBody);
    } catch (err: unknown) {
        // eslint-disable-next-line no-console
        console.error("crossPostReply failed (feed visibility only - the real reply already sent)", err);
    }
}

/** Resolves the replied-to event's embeddable RepostContent and cross-posts the reply into the
 *  replier's own profile room — skipped entirely (not an error) when the replier has no profile
 *  room linked, or when they're already replying from within it (nothing to surface elsewhere). */
async function crossPostReply(
    client: MatrixClient,
    roomId: string,
    parentEventId: string,
    body: string,
    formattedBody?: string,
): Promise<void> {
    const myUserId = client.getSafeUserId();
    const profileRoomId = await getProfileRoomLink(client, myUserId);
    if (!profileRoomId || profileRoomId === roomId) return;

    const parentEvent = client.getRoom(roomId)?.findEventById(parentEventId);
    if (!parentEvent) return;

    const repliedTo: RepostContent = {
        event_id: parentEventId,
        room_id: roomId,
        sender: parentEvent.getSender() ?? "",
        ...(parentEvent.sender?.name ? { displayname: parentEvent.sender.name } : {}),
        content: parentEvent.getContent(),
    };
    await crossPostReplyToProfile(client, profileRoomId, body, repliedTo, formattedBody);
}

/**
 * Embeds the original post's sender and its entire content (MSC4501 m.social.repost_of) so a
 * repost can be rendered, including attribution, without fetching the original event.
 */
export interface RepostContent {
    event_id: string;
    room_id: string;
    sender: string;
    /** Original poster's display name at repost time. Optional per MSC4501 — clients fall back to
     *  the bare `sender` Matrix ID when absent, same as anywhere else a display name is unset. */
    displayname?: string;
    /** The original event's entire `content` (body, formatted_body, media fields, etc.), copied
     *  in as-is — not just `body` — so the repost renders identically to how the original was
     *  authored. */
    content: Record<string, unknown>;
}

/**
 * Sends a repost containing an org.matrix.msc4501.social.relates_to block with
 * rel_type: org.matrix.msc4501.social.repost — see currentPostEventType() for which event type.
 * `body` is either the reposting user's own commentary (a quote-post) or a matrix.to/matrix:
 * permalink to the reposted event (a boost/retweet) — see MSC4501's
 * Reposting/Boosting/Retweeting/Quote Posting section for why a boost uses a permalink rather than
 * an empty body.
 *
 * Also sends a 🔁 m.reaction annotating the reposted event, per MSC4501's Repost/boost counts
 * section, so any client can compute a repost/boost count via the same reaction-aggregation
 * mechanism used for likes — best-effort: silently skipped if we lack permission to react in the
 * reposted event's room (e.g. reposting from a room we're not joined to), same as the MSC allows.
 */
export async function sendRepost(
    client: MatrixClient,
    targetRoomId: string,
    body: string,
    reposted: RepostContent,
    file?: File,
): Promise<void> {
    const content: Record<string, unknown> = file
        ? await buildMediaMessageContent(client, targetRoomId, file, body)
        : { body, msgtype: "m.text", format: "plain" };
    content[MSC4501_RELATES_TO_KEY] = {
        rel_type: MSC4501_REL_TYPE_REPOST,
        event_id: reposted.event_id,
        room_id: reposted.room_id,
        sender: reposted.sender,
        ...(reposted.displayname ? { displayname: reposted.displayname } : {}),
        content: reposted.content,
    };
    await client.sendEvent(targetRoomId, currentPostEventType() as any, content);
    void sendPostReadReceipt(client, reposted.room_id, reposted.event_id);

    try {
        await sendRepostReaction(client, reposted.room_id, reposted.event_id);
    } catch {
        // Not joined/no permission to react in the reposted event's own room — the repost itself
        // already sent fine above, and the MSC explicitly allows the count to simply not
        // increment from this repost in that case.
    }
}

/** Sends a 🔁 m.reaction (m.annotation) to the given event — see sendRepost's own doc. */
export async function sendRepostReaction(client: MatrixClient, roomId: string, eventId: string): Promise<void> {
    await client.sendEvent(roomId, "m.reaction" as any, {
        "m.relates_to": {
            rel_type: "m.annotation",
            event_id: eventId,
            key: "🔁",
        },
    });
}

/**
 * Cross-posts a reply into the replying user's own profile room, per MSC4501's "Cross-posting a
 * reply to your profile" section: an ordinary m.social.post with an org.matrix.msc4501.social.
 * relates_to block (rel_type: org.matrix.msc4501.social.reply) pointing at the post being replied
 * to. This is purely for feed visibility — the real in-thread reply is the separate m.thread-
 * related event sendComment sends into the room the reply was actually made in; this cross-post is
 * never used for thread aggregation or reaction counts.
 */
export async function crossPostReplyToProfile(
    client: MatrixClient,
    profileRoomId: string,
    body: string,
    repliedTo: RepostContent,
    formattedBody?: string,
): Promise<void> {
    await client.sendEvent(profileRoomId, currentPostEventType() as any, {
        body,
        msgtype: "m.text",
        ...(formattedBody
            ? { format: "org.matrix.custom.html", formatted_body: formattedBody }
            : { format: "plain" }),
        [MSC4501_RELATES_TO_KEY]: {
            rel_type: MSC4501_REL_TYPE_REPLY,
            event_id: repliedTo.event_id,
            room_id: repliedTo.room_id,
            sender: repliedTo.sender,
            ...(repliedTo.displayname ? { displayname: repliedTo.displayname } : {}),
            content: repliedTo.content,
        },
    });
}

/**
 * Sends a 👍 reaction (m.reaction / m.annotation) to the given event.
 */
export async function sendLike(
    client: MatrixClient,
    roomId: string,
    eventId: string,
): Promise<void> {
    await client.sendEvent(roomId, "m.reaction" as any, {
        "m.relates_to": {
            rel_type: "m.annotation",
            event_id: eventId,
            key: "👍",
        },
    });
    void sendPostReadReceipt(client, roomId, eventId);
}

/**
 * Undoes a previously-sent 👍 reaction by redacting it.
 */
export async function undoLike(client: MatrixClient, roomId: string, reactionEventId: string): Promise<void> {
    await client.redactEvent(roomId, reactionEventId);
}

// ---------------------------------------------------------------------------
// Follow / Unfollow
// ---------------------------------------------------------------------------

export async function followRoom(client: MatrixClient, roomIdOrAlias: string): Promise<void> {
    await client.joinRoom(roomIdOrAlias);
}

export async function unfollowRoom(client: MatrixClient, roomId: string): Promise<void> {
    await client.leave(roomId);
    // Unlike joinRoom/knockRoom (whose promises effectively wait for the next sync to confirm the
    // new membership before resolving - see SyncApi.createRoom), client.leave() is a bare REST call
    // with no local echo of its own: it resolves the instant the server responds 200, well before
    // the room's own local membership actually updates via the next /sync. Since Social deliberately
    // stays on the room's own page after leaving (rather than navigating away like stock Element's
    // leaveRoomBehaviour does), a button reading this room's membership would otherwise sit showing
    // stale "Leave" text until whenever the next sync happens to land. Applying the update locally
    // ourselves is what makes it change immediately instead.
    client.getRoom(roomId)?.updateMyMembership(KnownMembership.Leave);
    // A separate, already-in-flight sync response (started before this leave) can still land with
    // the pre-leave membership and silently revert the line just above - see pendingRoomLeave.ts.
    markPendingLeave(roomId);
}

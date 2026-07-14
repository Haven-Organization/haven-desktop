/*
 * Social Overlay — PostRelationHeaderLine
 *
 * Shared by every "this post relates to another post" header line: the in-room reply fallback
 * quote (m.in_reply_to), a repost/boost (org.matrix.msc4501.social.repost), and a cross-posted
 * reply (org.matrix.msc4501.social.reply). One component so a change to how these look/behave
 * (color, hover preview, emoji, click target) applies to all three at once instead of needing to
 * be kept in sync across three separate ones by hand - that drift is exactly how the in-room reply
 * line ended up a different color from the other two despite using the same CSS class already.
 *
 * Hover preview: shows a snippet of the related post using whichever of these is available -
 * (1) the real event, if the room is already known locally (joined/peeked), or (2) the embedded
 * `content` snapshot MSC4501 carries on repost/cross-reply relations for exactly this situation.
 * Disabled entirely (no hover affordance at all) only when neither is available - i.e. the related
 * room isn't accessible *and* the relation was sent without an embedded content snapshot to fall
 * back on.
 */

import React, { type JSX, useEffect, useState } from "react";
import { MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";
import { M_TEXT } from "matrix-js-sdk/src/@types/extensible_events";

import { useMatrixClientContext } from "../../../../element-web/apps/web/src/contexts/MatrixClientContext";
import BaseAvatar from "../../../../element-web/apps/web/src/components/views/avatars/BaseAvatar";
import { RoomPermalinkCreator } from "../../../../element-web/apps/web/src/utils/permalinks/Permalinks";
import { stripReplyFallback } from "../utils/reply-fallback";
import { useLiveUserProfile } from "../utils/liveUserProfile";
import { resolvePostBodyString } from "../utils/postBody";

/** The embedded snapshot repost/cross-reply relations carry (repostOf.content/
 *  replyCrossPostOf.content in SocialEventTile.tsx) - not present for the in-room reply case, which
 *  always has a real event in the same room instead. */
export interface EmbeddedRelationPreview {
    sender: string;
    displayname?: string;
    body?: string;
}

/** Fallback label for the hover preview when a locally-known original event has no textual body at
 *  all (see noPreviewTextFallback below) - a plain msgtype, not exhaustive (polls/locations etc.
 *  have their own M_TEXT.findIn-derived fallback text already, so they never reach this map). */
const MEDIA_MSGTYPE_LABELS: Record<string, string> = {
    "m.image": "📷 Photo",
    "m.video": "🎥 Video",
    "m.audio": "🎵 Audio",
    "m.file": "📎 File",
};

interface Props {
    /** Emoji shown at the front of the line - every header line gets one, not just some. */
    icon: string;
    text: React.ReactNode;
    /** The room the related post is in, if already known locally (joined/peeked) - undefined if
     *  not (e.g. a repost/cross-reply from a room the viewer hasn't joined and hasn't peeked yet). */
    room: Room | undefined;
    eventId: string;
    embedded?: EmbeddedRelationPreview;
    onNavigate: (e: React.MouseEvent) => void;
}

export function PostRelationHeaderLine({ icon, text, room, eventId, embedded, onNavigate }: Props): JSX.Element {
    const client = useMatrixClientContext();
    const [showPreview, setShowPreview] = useState(false);
    const locallyKnownEvent = room?.findEventById(eventId) ?? null;

    // Same gap as RepliedToIndicator's own identical fetchRoomEvent fallback: a reply target that
    // got edited almost immediately after being sent can end up with only its EDIT event ever
    // separately synced locally, leaving the original send itself (what eventId actually points
    // at) unfindable via room.findEventById even though it's a real, permanently existing event
    // server-side. Without this, the preview below always showed "(message not in local
    // timeline)" for such a target - not because it was unavailable, just because it was never
    // fetched.
    const [fetchedEvent, setFetchedEvent] = useState<MatrixEvent | null>(null);
    useEffect(() => {
        setFetchedEvent(null);
        if (locallyKnownEvent || !room) return;
        let cancelled = false;
        client
            .fetchRoomEvent(room.roomId, eventId)
            .then((raw) => {
                if (!cancelled) setFetchedEvent(new MatrixEvent(raw));
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [client, room, eventId, locallyKnownEvent]);

    const originalEvent = locallyKnownEvent ?? fetchedEvent;
    const canPreview = !!originalEvent || !!embedded;

    const previewSenderId = originalEvent?.getSender() ?? embedded?.sender;
    // originalEvent.sender (a RoomMember) is only ever populated by a timeline actually adding the
    // event to itself - a freestanding fetchRoomEvent result never goes through that, so it's null
    // here regardless of whether the sender is actually well known. room.getMember() reads the
    // room's own membership state instead, which doesn't depend on this specific event object.
    const previewSender = originalEvent
        ? (originalEvent.sender?.name ??
              (previewSenderId ? room?.getMember(previewSenderId)?.name : undefined) ??
              previewSenderId ??
              "unknown")
        : (embedded?.displayname || embedded?.sender || "unknown");
    // Polls (and anything else built on extensible events) have no `body` field at all - their
    // fallback text lives at content["org.matrix.msc1767.text"] instead (M_TEXT.findIn checks both
    // the stable and unstable key). Without this fallback, replying to a poll always showed
    // "(message not in local timeline)" even when the poll was genuinely loaded right there in the
    // same thread - body-less content isn't the same thing as "couldn't find the event".
    // resolvePostBodyString, not a raw .body read - org.matrix.msc4501.social.body takes priority
    // when filled out, same as everywhere else Social shows post content (see postBody.ts).
    // embedded?.body needs no equivalent here - it's already resolved, built from
    // SocialEventTile.tsx's own already-resolved repostOfContent/replyCrossPostOfContent.
    const originalEventContent = originalEvent?.getContent<{ body?: string; msgtype?: string }>();
    const originalEventText =
        resolvePostBodyString(originalEventContent) || M_TEXT.findIn<string>(originalEventContent ?? {});
    const previewBody = originalEvent
        ? stripReplyFallback((originalEventText ?? "").trim())
        : embedded?.body
          ? stripReplyFallback(embedded.body.trim())
          : null;
    // A plain media message (a bridged image/video/etc. with no caption) has nothing textual to show
    // here, but the event is still genuinely known locally - conflating that with "not in local
    // timeline" below would be an outright lie when originalEvent is set (the viewer can often see
    // the very same message rendered right above/below this line). Only fall back to the "not in
    // local timeline" wording when there's truly no local event at all (relying on embedded's own
    // snapshot instead, or nothing whatsoever).
    const noPreviewTextFallback = originalEvent
        ? (MEDIA_MSGTYPE_LABELS[originalEventContent?.msgtype ?? ""] ?? "(no text)")
        : "(message not in local timeline)";

    // Lazy - only fetched once the preview is actually shown, so a feed full of these lines doesn't
    // fire a profile lookup per line just from being mounted. Prefers the room member's own (already
    // locally-known, no fetch needed) avatar when there is one, since that's guaranteed in sync with
    // what the rest of the tile shows for the same sender.
    const liveProfile = useLiveUserProfile(client, showPreview ? previewSenderId : undefined);
    const previewAvatarUrl = originalEvent?.sender?.getMxcAvatarUrl() || liveProfile?.avatarUrl;
    const previewHttpAvatarUrl = previewAvatarUrl ? client.mxcUrlToHttp(previewAvatarUrl, 32, 32, "crop") : null;

    // A real matrix.to href where possible (so it behaves like any other permalink - hover shows
    // the target in the status bar, right-click lets you copy it, etc.) but the click itself is
    // intercepted to navigate within Social instead of falling through to matrix.to or kicking the
    // app out to the regular room timeline.
    const href = room ? new RoomPermalinkCreator(room).forEvent(eventId) : undefined;

    return (
        <div className="social_EventTile_replyTo" onClick={(e) => e.stopPropagation()}>
            <a
                href={href}
                className="social_EventTile_replyToBtn"
                onMouseEnter={canPreview ? () => setShowPreview(true) : undefined}
                onMouseLeave={canPreview ? () => setShowPreview(false) : undefined}
                onClick={onNavigate}
            >
                {/* One flex item for the whole phrase, not three (the icon, then whatever pieces
                    `text` itself is made of - e.g. "reply to " / <strong>name</strong> / "'s post")
                    - .social_EventTile_replyToBtn's own `gap` (for spacing the icon from the text)
                    otherwise inserts that same gap between every one of text's own child nodes too,
                    since a Fragment's children flatten into direct flex children - showing up as an
                    unwanted space between the name and "'s post". */}
                {icon} <span>{text}</span>
            </a>
            {showPreview && canPreview && (
                <div className="social_EventTile_replyPreview">
                    <div className="social_EventTile_replyPreview_sender">
                        <BaseAvatar
                            name={previewSender}
                            idName={previewSenderId}
                            url={previewHttpAvatarUrl ?? undefined}
                            size="20px"
                        />
                        <span>{previewSender}</span>
                    </div>
                    {previewBody ? (
                        <p className="social_EventTile_replyPreview_body">
                            {previewBody.slice(0, 200)}
                            {previewBody.length > 200 ? "…" : ""}
                        </p>
                    ) : (
                        <p className="social_EventTile_replyPreview_body" style={{ fontStyle: "italic" }}>
                            {noPreviewTextFallback}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}

/** "reply to X's post" wording shared by the in-room reply and cross-posted-reply header lines -
 *  see PostRelationHeaderLine's own doc for why these two (and the repost line) share one
 *  component. Deliberately does not name *this* post's own sender (shown by the tile's own header
 *  right above it already) - only the original post's author, or nothing at all if that's unknown. */
export function inReplyToText(originalSenderName: string | null): React.ReactNode {
    // "reply", not "reply to" - dropping the dangling preposition here matters: this is a reply,
    // we just couldn't derive *who* it's replying to (the target genuinely couldn't be resolved,
    // even via the fetchRoomEvent fallback - e.g. it's been redacted, or the relation is cross-room
    // to somewhere inaccessible) - "reply to" with nothing after it reads as a rendering bug rather
    // than an honest "we don't know" the way plain "reply" does.
    if (!originalSenderName || originalSenderName === "unknown") return "reply";
    return (
        <>
            reply to <strong>{originalSenderName}</strong>'s post
        </>
    );
}

/*
 * Social Overlay — SocialEventTile
 *
 * Renders a single social post as a bordered card.
 * Features: file embedding, URL preview, "..." menu with event source viewer,
 * like (👍 m.reaction), reply, and repost actions.
 * Clicking the card body navigates to the thread view (when onViewThread is set).
 */

import React, { type JSX, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
    MatrixEvent,
    type Relations,
    RelationsEvent,
    type Room,
    type MatrixClient,
    type Membership,
    EventType,
    MsgType,
    JoinRule,
    RoomEvent,
} from "matrix-js-sdk/src/matrix";
import { M_POLL_START } from "matrix-js-sdk/src/@types/polls";
import { KnownMembership } from "matrix-js-sdk/src/types";
import { ReplyIcon, RestartIcon, EditIcon } from "@vector-im/compound-design-tokens/assets/web/icons";
import {
    EventContentBodyView,
    LINKIFIED_DATA_ATTRIBUTE,
    useCreateAutoDisposedViewModel,
} from "@element-hq/web-shared-components";

import MemberAvatar from "../../../../element-web/apps/web/src/components/views/avatars/MemberAvatar";
import BaseAvatar from "../../../../element-web/apps/web/src/components/views/avatars/BaseAvatar";
import { useMatrixClientContext } from "../../../../element-web/apps/web/src/contexts/MatrixClientContext";
import Modal from "../../../../element-web/apps/web/src/Modal";
import ImageView from "../../../../element-web/apps/web/src/components/views/elements/ImageView";
import QuestionDialog from "../../../../element-web/apps/web/src/components/views/dialogs/QuestionDialog";
import ErrorDialog from "../../../../element-web/apps/web/src/components/views/dialogs/ErrorDialog";
import MessageEditHistoryDialog from "../../../../element-web/apps/web/src/components/views/dialogs/MessageEditHistoryDialog";
import BaseDialog from "../../../../element-web/apps/web/src/components/views/dialogs/BaseDialog";
import DialogButtons from "../../../../element-web/apps/web/src/components/views/elements/DialogButtons";
import { useContextMenu, toRightOf } from "../../../../element-web/apps/web/src/components/structures/ContextMenu";
import defaultDispatcher from "../../../../element-web/apps/web/src/dispatcher/dispatcher";
import { Action } from "../../../../element-web/apps/web/src/dispatcher/actions";
import { type ViewRoomPayload } from "../../../../element-web/apps/web/src/dispatcher/payloads/ViewRoomPayload";
import { EventContentBodyViewModel } from "../../../../element-web/apps/web/src/viewmodels/message-body/EventContentBodyViewModel";
import MessageEvent from "../../../../element-web/apps/web/src/components/views/messages/MessageEvent";
import RoomContext from "../../../../element-web/apps/web/src/contexts/RoomContext";
import { SdkContextClass } from "../../../../element-web/apps/web/src/contexts/SDKContext";
import {
    tryTransformPermalinkToLocalHref,
    parsePermalink,
    RoomPermalinkCreator,
} from "../../../../element-web/apps/web/src/utils/permalinks/Permalinks";
import {
    MSC4501_EVENT_POST,
    MSC4501_RELATES_TO_KEY,
    MSC4501_REL_TYPE_REPOST,
    MSC4501_REL_TYPE_REPLY,
    MSC4501_BODY_KEY,
    MSC4501_FORMATTED_BODY_KEY,
} from "../utils/room-classifier";
import { resolvePostBody, resolvePostBodyString, hasPostBodyOverride } from "../utils/postBody";
import { type RepostContent, sendRepost, sendPostReadReceipt } from "../utils/social-actions";
import { tryRouteSocialPermalink } from "../utils/permalinkRouting";
import { useProfileRoomLink } from "../utils/useProfileRoomLink";
import { useLiveUserProfile } from "../utils/liveUserProfile";
import { ExternalHandleIcon } from "./ExternalHandleIcon";
import { stripReplyFallback } from "../utils/reply-fallback";
import {
    PostRelationHeaderLine,
    inReplyToText,
    type EmbeddedRelationPreview,
} from "./PostRelationHeaderLine";
import SocialMessageContextMenu from "./SocialMessageContextMenu";
import { LikeButton } from "./LikeButton";
import { ReplyComposerDialog } from "./ReplyComposerDialog";
import { RepostDialog } from "./RepostDialog";
import { SocialReactionsRow, getPostReactions } from "./SocialReactionsRow";
import { getReactionGroups } from "../../../../element-web/apps/web/src/components/views/rooms/EventTile/ReactionsRowAdapter";

interface Props {
    event: MatrixEvent;
    room: Room;
    isLiked: boolean;
    /** Whether this user already has a 🔁 reaction on this post — highlights the Repost button. */
    isReposted: boolean;
    replyCount: number;
    /** When true, hides the room name link in the sender row (used for own-profile posts). */
    hideRoomName?: boolean;
    /** When provided, clicking the post card body navigates to the thread view. */
    onViewThread?: (event: MatrixEvent, room: Room) => void;
    onRoomClick?: (roomId: string) => void;
    /** When provided, clicking the sender's name (or a user pill in the body) navigates to their
     *  Social profile room, or a placeholder page if they haven't linked one — never opens the
     *  stock RightPanel. */
    onViewUser?: (userId: string) => void;
    /** When provided, clicking the sender's avatar opens the stock member-info RightPanel for them
     *  (scoped to this post's own room), instead of onViewUser's Social-profile navigation - the
     *  same distinction stock Element draws between clicking a name vs. an avatar. */
    onOpenUserPanel?: (userId: string, room: Room) => void;
    onLike?: () => Promise<void>;
    onReply?: (body: string, file?: File) => Promise<void>;
    /** Navigates to the Social app's own Profile tab — used by the Boost button's "you don't have
     *  a profile room yet" warning. */
    onNavigateToProfile?: () => void;
    /**
     * Bumped by useBackfillSocialRooms once a room's membership finishes loading. Used only as
     * the `key` of the message body below, so pills (which resolve member data once on mount, see
     * usePermalinkMember) remount and re-resolve once membership is available. Deliberately scoped
     * to just that div, not the whole tile — keying the whole article here would remount the media
     * (image/video/audio) on every membership load, killing playback and flickering the feed.
     */
    pillsGeneration?: number;
    /** Shows the full date/time instead of the usual shortened relative one (e.g. "2h", "Jul 8") -
     *  used by SocialPostView for the focused post and the thread root, which are singular enough
     *  in a thread view to warrant the exact time up front rather than making it hover-only. Every
     *  timestamp gets the full date/time as a hover tooltip regardless of this prop. */
    forceFullTimestamp?: boolean;
}

/** Returns the mx_Username_color{n} class for a Matrix user ID. */
function colorClassForId(id: string): string {
    const n = id.split("").reduce((s: number, c: string) => s + c.charCodeAt(0), 0) % 6 + 1;
    return `mx_Username_color${n}`;
}

/** Genuine, unexpected failure (network error, server rejected the request outright) - not an
 *  access-restriction case, those get their own modals below (see resolveAndOpenPost). */
function showCannotPreviewError(): void {
    Modal.createDialog(ErrorDialog, {
        title: "Can't open this post",
        description: "Something went wrong trying to open this post.",
    });
}

/** Fetches an event directly from the server, retrying a few times with a short delay before
 *  giving up. Right after joining a room whose full history your own homeserver hadn't already
 *  backfilled from federation (the common case for a knock-only room you weren't a member of a
 *  moment ago), a single fetchRoomEvent call for an older event can genuinely fail - not because
 *  the event doesn't exist or you lack access, but because your homeserver's own copy of that
 *  room's history is still catching up. Confirmed live: the exact same call that failed
 *  immediately after an auto-accepted knock succeeded fine moments later with no other change -
 *  this is what was silently swallowing "auto-accepted the follow request, but never opened the
 *  post" even after the event genuinely existed and was fetchable. */
async function fetchRoomEventWithRetry(
    client: MatrixClient,
    roomId: string,
    eventId: string,
    attempts = 5,
    delayMs = 1000,
): Promise<MatrixEvent> {
    for (let attempt = 1; ; attempt++) {
        try {
            return new MatrixEvent(await client.fetchRoomEvent(roomId, eventId));
        } catch (err) {
            if (attempt >= attempts) throw err;
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
}

/** "This profile is private" - invite-only/restricted rooms, or a summary request the server
 *  refused outright (same "can't tell, so treat it as private" fallback resolveProfileRoom uses).
 *  Exported for permalinkRouting.ts's own consuming side - see resolveAndOpenPost's own export. */
export function showPrivateProfileModal(): void {
    Modal.createDialog(QuestionDialog, {
        title: "Private profile",
        description: "This user's profile is private.",
        button: "OK",
        hasCancelButton: false,
        onFinished: () => {},
    });
}

/** Whatever the room summary (MSC3266) actually gave us - avatar/name/member count where present,
 *  nothing invented. Shared by the join-to-follow and knock-to-follow modals below. */
function RoomSummaryPreview({
    client,
    name,
    avatarUrl,
    numJoinedMembers,
}: {
    client: MatrixClient;
    name?: string;
    avatarUrl?: string;
    numJoinedMembers?: number;
}): JSX.Element {
    const httpAvatarUrl = avatarUrl ? client.mxcUrlToHttp(avatarUrl, 40, 40, "crop") : null;
    return (
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
            <BaseAvatar name={name ?? "?"} idName={name} url={httpAvatarUrl ?? undefined} size="40px" />
            <div>
                <div style={{ fontWeight: 600 }}>{name ?? "Unknown"}</div>
                {typeof numJoinedMembers === "number" && (
                    <div style={{ fontSize: "0.85em", opacity: 0.7 }}>
                        {numJoinedMembers} {numJoinedMembers === 1 ? "follower" : "followers"}
                    </div>
                )}
            </div>
        </div>
    );
}

/** "You need to follow this profile to see this post" - shown once a peek attempt has already
 *  failed for what turned out to be a public (but not world-readable, so unpeekable) room.
 *  Confirming joins the room, then navigates to the post the user originally clicked. */
function showJoinToFollowModal(
    client: MatrixClient,
    roomId: string,
    eventId: string,
    fallbackEvent: MatrixEvent | undefined,
    onViewThread: (event: MatrixEvent, room: Room) => void,
    summary: { name?: string; avatar_url?: string; num_joined_members?: number },
): void {
    Modal.createDialog(QuestionDialog, {
        title: "Follow to see this post",
        description: (
            <>
                <RoomSummaryPreview
                    client={client}
                    name={summary.name}
                    avatarUrl={summary.avatar_url}
                    numJoinedMembers={summary.num_joined_members}
                />
                <p>You need to follow this profile to see its posts.</p>
            </>
        ),
        button: "Follow",
        onFinished: (ok?: boolean) => {
            if (!ok) return;
            void (async () => {
                try {
                    await client.joinRoom(roomId);
                } catch {
                    showCannotPreviewError();
                    return;
                }
                const room = client.getRoom(roomId);
                if (!room) return;
                // Same fallback as resolveAndOpenPost's own branches for the identical reason - a
                // freshly-joined room's initial sync doesn't necessarily reach back far enough to
                // include this specific (possibly older) event.
                let resolvedEvent = room.findEventById(eventId) ?? fallbackEvent;
                if (!resolvedEvent) {
                    try {
                        resolvedEvent = await fetchRoomEventWithRetry(client, roomId, eventId);
                    } catch {
                        // Genuinely couldn't resolve it even with retries - nothing left to do.
                    }
                }
                if (resolvedEvent) onViewThread(resolvedEvent, room);
            })();
        },
    });
}

/** "You must request to follow this profile before you can see their posts" - shown for a
 *  knock-only room. Confirming sends the knock; there's nowhere to navigate to yet since access
 *  isn't granted until the profile's owner accepts it. */
interface KnockToFollowDialogProps {
    client: MatrixClient;
    roomId: string;
    eventId: string;
    fallbackEvent: MatrixEvent | undefined;
    onViewThread: (event: MatrixEvent, room: Room) => void;
    summary: { name?: string; avatar_url?: string; num_joined_members?: number };
    onFinished: () => void;
}

/** Stays open through the whole knock, rather than closing immediately like a plain QuestionDialog
 *  would - that was the actual bug behind "Send Follow Request doesn't seem to send a knock": the
 *  request itself worked, but the dialog closing instantly with no visible before/after gave no way
 *  to tell it had done anything at all. Also watches for this exact room's invite arriving while
 *  the dialog is still open (i.e. the profile owner accepts the request) and auto-joins straight to
 *  the post that was originally clicked, rather than leaving the user to notice and click through
 *  it themselves. */
function KnockToFollowDialog({
    client,
    roomId,
    eventId,
    fallbackEvent,
    onViewThread,
    summary,
    onFinished,
}: KnockToFollowDialogProps): JSX.Element {
    const [state, setState] = useState<"idle" | "sending" | "sent" | "accepting" | "error">("idle");
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    // Guards acceptAndOpen against running twice in parallel - both the mount check and the
    // membership listener below can independently decide to run it (e.g. the invite arrives in the
    // instant between mount and the listener attaching).
    const acceptingRef = useRef(false);

    // Joins, resolves the originally-clicked event, navigates to it, and closes the dialog. Shared
    // by both an invite that's already there the moment this dialog opens (see the mount effect
    // below - a knock_restricted room a bridge/appservice or the server's own restricted-room logic
    // can auto-invite for before the user ever clicks anything, or a leftover invite from an
    // earlier attempt) and one that arrives later while it's still open.
    const acceptAndOpen = useCallback(async () => {
        if (acceptingRef.current) return;
        acceptingRef.current = true;
        setState("accepting");
        try {
            await client.joinRoom(roomId);
        } catch {
            acceptingRef.current = false;
            return; // stay on the current state - the invite is still there to act on manually
        }
        const joinedRoom = client.getRoom(roomId);
        if (!joinedRoom) return;
        // A freshly-joined room's initial sync-provided timeline doesn't necessarily reach back far
        // enough to include the specific (possibly old) event being followed to see in the first
        // place - findEventById alone silently missing it here is exactly what used to leave the
        // user "auto-accepted, but not taken to the post" once the owner approved the request.
        // fetchRoomEventWithRetry gets it directly from the server instead of only trusting what's
        // already synced locally - see its own doc for why this specifically needs retries, not
        // just one fallback attempt.
        let targetEvent = joinedRoom.findEventById(eventId) ?? fallbackEvent;
        if (!targetEvent) {
            try {
                targetEvent = await fetchRoomEventWithRetry(client, roomId, eventId);
            } catch {
                // Genuinely couldn't resolve it even with retries - still finish below so the
                // dialog doesn't stay stuck open forever; the user is just left on whatever page
                // they were already on instead of jumping to the post.
            }
        }
        if (targetEvent) onViewThread(targetEvent, joinedRoom);
        onFinished();
    }, [client, roomId, eventId, fallbackEvent, onViewThread, onFinished]);

    // Listens for the whole lifetime of the dialog, not just once state reaches "sent" - a real
    // ghost/bot account can approve a knock near-instantly, sometimes fast enough that the invite
    // (and this same MyMembership event) arrives before knockRoom() below has even finished
    // resolving, let alone before a listener gated on state==="sent" would attach. An event emitter
    // never redelivers to a listener that wasn't attached yet when it fired - gating this on state
    // meant that race could silently miss the invite forever, leaving the dialog stuck on "Follow
    // Request Sent" even though the invite had already come and gone. Listening unconditionally
    // from mount removes that gap entirely - there is no window where an arriving invite isn't
    // being watched for. Also covers an invite that's already sitting there the moment this dialog
    // opens at all (checked directly on mount, not just via the listener, since the listener alone
    // can't retroactively catch something that already happened before mount) - e.g. a
    // knock_restricted room where the server's own restricted-room membership rules (or a
    // bridge/appservice's automation) auto-invite before the user ever clicks Send Follow Request,
    // or a leftover invite from an earlier, not-fully-completed attempt.
    useEffect(() => {
        if (client.getRoom(roomId)?.getMyMembership() === KnownMembership.Invite) {
            void acceptAndOpen();
        }
        const onMyMembership = (room: Room, membership: Membership): void => {
            if (room.roomId !== roomId || membership !== KnownMembership.Invite) return;
            void acceptAndOpen();
        };
        client.on(RoomEvent.MyMembership, onMyMembership);
        return () => {
            client.off(RoomEvent.MyMembership, onMyMembership);
        };
    }, [client, roomId, acceptAndOpen]);

    const handleSend = useCallback(async () => {
        setState("sending");
        try {
            await client.knockRoom(roomId);
        } catch (err) {
            // A knock rejected specifically because you're already invited (see the listener
            // effect's own doc for how that can happen even on a genuinely first attempt) isn't a
            // real failure - accept the invite that's already there instead of showing an error.
            if (client.getRoom(roomId)?.getMyMembership() === KnownMembership.Invite) {
                void acceptAndOpen();
                return;
            }
            setState("error");
            setErrorMessage(err instanceof Error ? err.message : "Failed to send follow request");
            return;
        }
        // Same instant-bot race as the listener above: the invite (and this account's own
        // membership update) can already be sitting here by the time knockRoom() itself finishes
        // resolving, before this component has re-rendered with state "sent" and before the
        // listener would otherwise be the one to notice. Check directly rather than assume the
        // listener will always get there first.
        if (client.getRoom(roomId)?.getMyMembership() === KnownMembership.Invite) {
            void acceptAndOpen();
            return;
        }
        setState("sent");
    }, [client, roomId, acceptAndOpen]);

    const busy = state === "sending" || state === "sent" || state === "accepting";
    const primaryLabel =
        state === "accepting"
            ? "Opening…"
            : state === "sent"
              ? "Follow Request Sent"
              : state === "sending"
                ? "Sending…"
                : "Send Follow Request";

    return (
        <BaseDialog className="mx_QuestionDialog" onFinished={onFinished} title="Follow request required" contentId="mx_Dialog_content">
            <div className="mx_Dialog_content" id="mx_Dialog_content">
                <RoomSummaryPreview
                    client={client}
                    name={summary.name}
                    avatarUrl={summary.avatar_url}
                    numJoinedMembers={summary.num_joined_members}
                />
                <p>You must request to follow this profile before you can see their posts.</p>
                {state === "error" && errorMessage && <p className="social_Error">{errorMessage}</p>}
            </div>
            <DialogButtons
                primaryButton={primaryLabel}
                onPrimaryButtonClick={() => void handleSend()}
                primaryDisabled={busy}
                cancelButton="Cancel"
                onCancel={onFinished}
                disabled={busy}
            />
        </BaseDialog>
    );
}

function showKnockToFollowModal(
    client: MatrixClient,
    roomId: string,
    eventId: string,
    fallbackEvent: MatrixEvent | undefined,
    onViewThread: (event: MatrixEvent, room: Room) => void,
    summary: { name?: string; avatar_url?: string; num_joined_members?: number },
): void {
    Modal.createDialog(KnockToFollowDialog, { client, roomId, eventId, fallbackEvent, onViewThread, summary });
}

/**
 * Shared by every "click through to a repost/boost/cross-posted reply's original" site (the repost
 * card, the quoted-reply card, and their two text-link indicators above them). Tries a peek first
 * (covers the common "public and world-readable" case with no interruption, same approach
 * resolveProfileRoom uses) - only once that fails does it fetch the room summary to work out which
 * of the three modals above (or a genuine error) actually applies.
 */
/** Exported for permalinkRouting.ts's own consuming side (SocialHomeView's pendingViewPost mount
 *  effect) - the same peek/join/knock/private resolution a repost/cross-reply header line's click
 *  already needs applies equally to "a matrix.to link to this room was clicked from outside Social
 *  entirely, and the room turned out to be a Social one." */
export function resolveAndOpenPost(
    client: MatrixClient,
    roomId: string,
    eventId: string,
    fallbackEvent: MatrixEvent | undefined,
    onViewThread: (event: MatrixEvent, room: Room) => void,
): void {
    void (async () => {
        const existingRoom = client.getRoom(roomId);
        if (existingRoom?.getMyMembership() === KnownMembership.Join) {
            // findEventById alone silently failing here - and this whole function just giving up
            // right after, with no fallback and no further attempt - is the actual bug behind
            // "brought to the room, but never opened the post" even for an already-joined room:
            // an older post can genuinely be outside this client's locally-synced timeline window
            // without the room itself being unavailable in any way. fetchRoomEventWithRetry (same
            // fallback the knock flow below already needed for the identical reason) gets it
            // directly from the server instead of quietly stopping here.
            let targetEvent = existingRoom.findEventById(eventId) ?? fallbackEvent;
            if (!targetEvent) {
                try {
                    targetEvent = await fetchRoomEventWithRetry(client, roomId, eventId);
                } catch {
                    // Genuinely couldn't resolve it even with retries - nothing left to do.
                }
            }
            if (targetEvent) onViewThread(targetEvent, existingRoom);
            return;
        }

        try {
            await client.peekInRoom(roomId);
            const room = client.getRoom(roomId);
            if (room) {
                // A knock-restricted room can still be world-readable (peekable) even though
                // actually following it requires a request - silently landing on the room here
                // just because the peek happened to work isn't good enough: the user never sees
                // why a follow request is needed, and misses out on this same modal's own
                // auto-accept-then-jump-to-this-post behavior once the request is approved (that
                // behavior lives in the modal, not in just being able to peek). Route these through
                // the same knock modal every other knock room gets below, using this already-
                // fetched room's own real name/avatar/member count instead of a second
                // getRoomSummary round trip.
                const peekedJoinRule = room.getJoinRule() as unknown as string;
                const peekedIsKnockable = peekedJoinRule === JoinRule.Knock || peekedJoinRule === "knock_restricted";
                if (!peekedIsKnockable) {
                    // Same fallback as the already-joined branch above, for the same reason - a
                    // peeked room's locally-available history is even less likely to reach back to
                    // an older event than a joined room's, so this needs it at least as much.
                    let targetEvent = room.findEventById(eventId) ?? fallbackEvent;
                    if (!targetEvent) {
                        try {
                            targetEvent = await fetchRoomEventWithRetry(client, roomId, eventId);
                        } catch {
                            // Genuinely couldn't resolve it even with retries - nothing left to do.
                        }
                    }
                    if (targetEvent) onViewThread(targetEvent, room);
                    return;
                }
                showKnockToFollowModal(client, roomId, eventId, fallbackEvent, onViewThread, {
                    name: room.name,
                    avatar_url: room.getMxcAvatarUrl() ?? undefined,
                    num_joined_members: room.getJoinedMemberCount(),
                });
                return;
            }
        } catch {
            // Not public-and-world-readable (or genuinely not accessible at all) - fall through to
            // the summary-based resolution below to work out which is actually the case.
        }

        let summary;
        try {
            summary = await client.getRoomSummary(roomId);
        } catch {
            showPrivateProfileModal();
            return;
        }
        const joinRule = summary.join_rule as unknown as string | undefined;

        if (joinRule === JoinRule.Public) {
            showJoinToFollowModal(client, roomId, eventId, fallbackEvent, onViewThread, summary);
        } else if (joinRule === JoinRule.Knock || joinRule === "knock_restricted") {
            showKnockToFollowModal(client, roomId, eventId, fallbackEvent, onViewThread, summary);
        } else {
            showPrivateProfileModal();
        }
    })();
}

// ---------------------------------------------------------------------------
// URL preview sub-component (own hooks, own async fetch)
// ---------------------------------------------------------------------------

function UrlPreview({ url, ts }: { url: string; ts: number }): JSX.Element | null {
    const client = useMatrixClientContext();
    const [preview, setPreview] = useState<Record<string, unknown> | null>(null);

    useEffect(() => {
        let active = true;
        client
            .getUrlPreview(url, ts)
            .then((data) => {
                if (active) setPreview(data as Record<string, unknown>);
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [url, ts, client]);

    if (!preview) return null;

    const title = typeof preview["og:title"] === "string" ? preview["og:title"].trim() : "";
    const description =
        typeof preview["og:description"] === "string" ? preview["og:description"].trim() : "";
    const ogImage = typeof preview["og:image"] === "string" ? preview["og:image"] : "";
    const httpImageUrl = ogImage ? client.mxcUrlToHttp(ogImage) : null;

    if (!title && !description && !httpImageUrl) return null;

    let hostname = url;
    try {
        hostname = new URL(url).hostname;
    } catch {}

    return (
        <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="social_EventTile_urlPreview"
            onClick={(e) => e.stopPropagation()}
        >
            {httpImageUrl && (
                <img
                    src={httpImageUrl}
                    alt=""
                    className="social_EventTile_urlPreview_image"
                />
            )}
            <div className="social_EventTile_urlPreview_body">
                {title && (
                    <div className="social_EventTile_urlPreview_title">{title}</div>
                )}
                {description && (
                    <div className="social_EventTile_urlPreview_desc">{description}</div>
                )}
                <div className="social_EventTile_urlPreview_hostname">{hostname}</div>
            </div>
        </a>
    );
}

// ---------------------------------------------------------------------------
// "In reply to" indicator — shown when a post has m.in_reply_to
// ---------------------------------------------------------------------------

interface RepliedToIndicatorProps {
    eventId: string;
    room: Room;
    fallbackSender: string | null;
    /** When provided, clicking the indicator navigates to the replied-to post (staying in Social)
     *  instead of just toggling the hover preview below. */
    onViewThread?: (event: MatrixEvent, room: Room) => void;
}

function RepliedToIndicator({ eventId, room, fallbackSender, onViewThread }: RepliedToIndicatorProps): JSX.Element {
    const client = useMatrixClientContext();
    const locallyKnownEvent = room.findEventById(eventId) ?? null;

    // A reply whose target got edited almost immediately after being sent can end up with only
    // its EDIT event ever separately synced locally - the original send itself (the event this
    // eventId actually points at) may never be locally cached at all, even though it's a
    // perfectly real, permanently existing event server-side (see SocialPostView's own identical
    // fetchRoomEvent fallback in findThreadAncestors, for the same underlying reason). Without
    // this, such a reply always showed a bare "reply to" with no name, even though a proper
    // "reply to X's post" was fully derivable - it just needed a targeted fetch.
    const [fetchedEvent, setFetchedEvent] = useState<MatrixEvent | null>(null);
    useEffect(() => {
        setFetchedEvent(null);
        if (locallyKnownEvent) return;
        let cancelled = false;
        client
            .fetchRoomEvent(room.roomId, eventId)
            .then((raw) => {
                if (!cancelled) setFetchedEvent(new MatrixEvent(raw));
            })
            .catch(() => {
                // Best-effort - genuinely inaccessible (e.g. a redacted or cross-room event) falls
                // back to the plain "reply" wording below, same as before this fetch existed.
            });
        return () => {
            cancelled = true;
        };
    }, [client, room, eventId, locallyKnownEvent]);

    const originalEvent = locallyKnownEvent ?? fetchedEvent;
    // originalEvent.sender (a RoomMember) is only ever populated by a timeline actually adding the
    // event to itself - a freestanding fetched event never goes through that, so it's always null
    // here regardless of whether the sender is actually well known. room.getMember() reads the
    // room's own membership state instead, which doesn't depend on this specific event object at
    // all, so it still resolves a real display name rather than falling straight to the raw MXID.
    const senderId = originalEvent?.getSender();
    const sender =
        originalEvent?.sender?.name ?? (senderId ? room.getMember(senderId)?.name : undefined) ?? senderId ?? fallbackSender ?? null;

    return (
        <PostRelationHeaderLine
            icon="↩"
            text={inReplyToText(sender)}
            room={room}
            eventId={eventId}
            onNavigate={(e) => {
                e.preventDefault();
                if (onViewThread && originalEvent) onViewThread(originalEvent, room);
            }}
        />
    );
}

// ---------------------------------------------------------------------------
// "Boosted this" indicator — shown above a boost's embedded repost card, matching
// RepliedToIndicator's style/link behaviour (see there for why a real href + intercepted click).
// ---------------------------------------------------------------------------

interface BoostedIndicatorProps {
    eventId: string;
    roomId: string;
    /** The *original* post's author - not the person who reposted it, who's already named by the
     *  tile's own header right above this line (same reasoning as inReplyToText's own doc). "unknown"
     *  means no real displayname could be resolved (live profile or embedded snapshot) - shows a bare
     *  "reposted" rather than naming a raw MXID in this compact header line. */
    originalSenderName: string;
    /** The embedded content snapshot (repostOf.content in the main render below) - lets the hover
     *  preview work even when the reposted room isn't locally accessible, per PostRelationHeaderLine's
     *  own doc on when hover is/isn't available. */
    embedded?: EmbeddedRelationPreview;
    onViewThread?: (event: MatrixEvent, room: Room) => void;
}

function BoostedIndicator({
    eventId,
    roomId,
    originalSenderName,
    embedded,
    onViewThread,
}: BoostedIndicatorProps): JSX.Element {
    const client = useMatrixClientContext();
    const targetRoom = client.getRoom(roomId) ?? undefined;

    return (
        <PostRelationHeaderLine
            icon="🔁"
            text={
                originalSenderName && originalSenderName !== "unknown" ? (
                    <>
                        reposted <strong>{originalSenderName}</strong>'s post
                    </>
                ) : (
                    "reposted"
                )
            }
            room={targetRoom}
            eventId={eventId}
            embedded={embedded}
            onNavigate={(e) => {
                e.preventDefault();
                if (!onViewThread) return;
                // Boosted content is almost always from a room the viewer hasn't joined - that's
                // the whole point of a boost - see resolveAndOpenPost for the full
                // peek/join/knock/private resolution.
                resolveAndOpenPost(client, roomId, eventId, undefined, onViewThread);
            }}
        />
    );
}

// ---------------------------------------------------------------------------
// "Replied to" indicator — shown above a cross-posted reply's quoted-original card (rel_type:
// org.matrix.msc4501.social.reply), matching BoostedIndicator's own style/link behaviour. Distinct
// from RepliedToIndicator above: that one is for the ordinary in-room m.in_reply_to fallback quote,
// this one is for the separate, feed-visibility-only cross-post MSC4501 defines — see
// crossPostReplyToProfile in social-actions.ts.
// ---------------------------------------------------------------------------

interface RepliedToProfileIndicatorProps {
    eventId: string;
    roomId: string;
    originalSenderName: string;
    embedded?: EmbeddedRelationPreview;
    onViewThread?: (event: MatrixEvent, room: Room) => void;
}

function RepliedToProfileIndicator({
    eventId,
    roomId,
    originalSenderName,
    embedded,
    onViewThread,
}: RepliedToProfileIndicatorProps): JSX.Element {
    const client = useMatrixClientContext();
    const targetRoom = client.getRoom(roomId) ?? undefined;

    return (
        <PostRelationHeaderLine
            icon="↩"
            text={inReplyToText(originalSenderName)}
            room={targetRoom}
            eventId={eventId}
            embedded={embedded}
            onNavigate={(e) => {
                e.preventDefault();
                if (!onViewThread) return;
                // Same fix as BoostedIndicator's own onNavigate above - the original post being
                // replied to is often in a room the viewer hasn't joined.
                resolveAndOpenPost(client, roomId, eventId, undefined, onViewThread);
            }}
        />
    );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SocialEventTile({
    event,
    room,
    isLiked,
    isReposted,
    replyCount,
    hideRoomName,
    onViewThread,
    onRoomClick,
    onViewUser,
    onOpenUserPanel,
    onLike,
    onReply,
    onNavigateToProfile,
    pillsGeneration,
    forceFullTimestamp,
}: Props): JSX.Element | null {
    const client = useMatrixClientContext();

    // All hooks unconditionally before any early returns (Rules of Hooks).
    const [likeBusy, setLikeBusy] = useState(false);
    const [boostBusy, setBoostBusy] = useState(false);
    const eventId = event.getId();
    // A post with zero reactions has no Relations aggregator in the SDK yet at all (
    // room.relations.getChildEventsForEvent returns undefined until the first one is added) — a
    // plain useMemo keyed on [client, room.roomId, eventId] would capture that `null` forever and
    // never learn a Relations object came into existence later, since none of those deps ever
    // change for a given post. That reproduced as "my reaction doesn't show up until I leave and
    // re-open the feed" (the remount recomputes the memo fresh). Once a Relations object exists it
    // manages its own live Add/Remove/Redaction updates fine (see SocialReactionsRow) — this only
    // needs to keep checking *before* that first object exists.
    const [reactions, setReactions] = useState<Relations | null>(() =>
        eventId ? getPostReactions(client, room.roomId, eventId) : null,
    );
    useEffect(() => {
        if (!eventId || reactions) return;
        const checkForRelations = (): void => {
            const found = getPostReactions(client, room.roomId, eventId);
            if (found) setReactions(found);
        };
        room.on("Room.timeline" as any, checkForRelations);
        return () => {
            room.off("Room.timeline" as any, checkForRelations);
        };
    }, [client, room, eventId, reactions]);
    // Like/Repost action-bar buttons always show their own reaction's count directly (see
    // LikeButton's own comment) rather than relying on SocialReactionsRow's separate pills for that
    // number - needs its own live-updating count here since `reactions` is a long-lived, mutating
    // Relations instance (same object reference throughout, not a fresh one per change), so a plain
    // derivation off it wouldn't re-run when a reaction is added/removed. Mirrors
    // SocialReactionsRow's own identical RelationsEvent listener pattern.
    const [reactionGroups, setReactionGroups] = useState(() => getReactionGroups(reactions));
    useEffect(() => {
        setReactionGroups(getReactionGroups(reactions));
        if (!reactions) return;
        const update = (): void => setReactionGroups(getReactionGroups(reactions));
        reactions.on(RelationsEvent.Add, update);
        reactions.on(RelationsEvent.Remove, update);
        reactions.on(RelationsEvent.Redaction, update);
        return () => {
            reactions.off(RelationsEvent.Add, update);
            reactions.off(RelationsEvent.Remove, update);
            reactions.off(RelationsEvent.Redaction, update);
        };
    }, [reactions]);
    const likeReactionCount = reactionGroups.find((g) => g.content === "👍")?.events.length ?? 0;
    const repostReactionCount = reactionGroups.find((g) => g.content === "🔁")?.events.length ?? 0;
    const myUserId = client.getSafeUserId();
    const canReact =
        room.getMyMembership() === KnownMembership.Join && room.currentState.maySendEvent(EventType.Reaction, myUserId);
    const canSelfRedact = room.currentState.maySendEvent(EventType.RoomRedaction, myUserId);
    const [menuDisplayed, menuHandle, openMenu, closeMenu] = useContextMenu<HTMLButtonElement>();
    const imgRef = useRef<HTMLImageElement>(null);
    // For the embedded repost/reply-cross-post cards' own images below - separate refs since a
    // post can show all three at once (its own file, a repost card, a quoted-reply card).
    const repostImgRef = useRef<HTMLImageElement>(null);
    const quotedImgRef = useRef<HTMLImageElement>(null);

    // MAudioBody/MVoiceMessageBody (stock audio & voice-message players, reused below) read
    // RoomContext.roomViewStore to register with PlaybackQueue — legacy RoomContext's own default
    // has `roomViewStore: undefined!` (a documented stock escape hatch), which is fine for most
    // consumers but would throw here since PlaybackQueue.forRoom actually calls a method on it.
    // Override just that field with the real singleton; everything else (incl.
    // timelineRenderingType: Room, which controls whether the file-info row also shows) already
    // matches the ambient default.
    const ambientRoomContext = useContext(RoomContext);
    const stockMediaRoomContext = useMemo(
        () => ({ ...ambientRoomContext, roomViewStore: SdkContextClass.instance.roomViewStore }),
        [ambientRoomContext],
    );

    const handleRoomClick = useCallback(() => {
        onRoomClick?.(room.roomId);
    }, [onRoomClick, room.roomId]);

    const handleLike = useCallback(async () => {
        if (!onLike || likeBusy) return;
        setLikeBusy(true);
        try {
            await onLike();
        } finally {
            setLikeBusy(false);
        }
    }, [onLike, likeBusy]);

    // Any emoji reaction sent via the hover picker (not just the 👍 shortcut above, which already
    // gets its own receipt from sendLike) still counts as reading this post.
    const handleReact = useCallback(() => {
        void sendPostReadReceipt(client, room.roomId, event.getId()!);
    }, [client, room, event]);

    const openReplyDialog = useCallback(() => {
        if (!onReply) return;
        Modal.createDialog(
            ReplyComposerDialog,
            {
                client,
                replyingToName: event.sender?.name ?? event.getSender() ?? "",
                room,
                replyTargetEvent: event,
                onReply,
            },
            "social_ReplyDialog_wrapper",
        );
    }, [onReply, event, room, client]);

    const openRepostDialog = useCallback(() => {
        Modal.createDialog(
            RepostDialog,
            { client, repostedEvent: event, repostedRoom: room },
            "social_RepostDialog_wrapper",
        );
    }, [event, room, client]);

    // Boost = a repost with no added commentary, sent straight to the user's own profile room with
    // no composer — see MSC4501's Reposting/Boosting/Retweeting section. Per the MSC, the outer
    // body is a permalink to the boosted event (not empty) so a non-compliant client viewing it as
    // a plain m.room.message shows a normal clickable link rather than a blank bubble.
    const profileRoomId = useProfileRoomLink(client, myUserId);
    const handleBoost = useCallback(async () => {
        // profileRoomId is a real GET /profile network round trip (see useProfileRoomLink) and can
        // still be resolving here. Unlike a composer, a boost sends immediately with no room picker
        // to double check against, so there's no safe local fallback to guess with - ask the user
        // to wait instead of risking a silent boost into the wrong room.
        if (profileRoomId === undefined) {
            Modal.createDialog(QuestionDialog, {
                title: "Still loading your profile",
                description: "Your profile is still loading. Try boosting again in a moment.",
                hasCancelButton: false,
                button: "OK",
            });
            return;
        }
        const targetRoomId = profileRoomId;

        if (!targetRoomId) {
            const { finished } = Modal.createDialog(QuestionDialog, {
                title: "No profile room set",
                description: "You don't have a profile room yet, so there's nowhere for a boost to go.",
                button: "Go to Profile",
            });
            finished.then(([goToProfile]: [boolean?]) => {
                if (goToProfile) onNavigateToProfile?.();
            });
            return;
        }

        setBoostBusy(true);
        try {
            const boostedEventId = event.getId() ?? "";
            const displayname = event.sender?.name;
            const reposted: RepostContent = {
                event_id: boostedEventId,
                room_id: room.roomId,
                sender: event.getSender() ?? "",
                ...(displayname ? { displayname } : {}),
                content: event.getContent(),
            };
            const permalink = new RoomPermalinkCreator(room).forEvent(boostedEventId);
            await sendRepost(client, targetRoomId, permalink, reposted);
        } finally {
            setBoostBusy(false);
        }
    }, [client, myUserId, profileRoomId, event, room, onNavigateToProfile]);

    // Derived values and early returns after all hooks.
    const sender = event.sender;
    const content = event.getContent<{
        body?: string;
        msgtype?: string;
        format?: string;
        formatted_body?: string;
        [MSC4501_BODY_KEY]?: string;
        [MSC4501_FORMATTED_BODY_KEY]?: string;
        url?: string;
        filename?: string;
        info?: { mimetype?: string };
        file?: { url: string; name: string; mimetype: string; size?: number };
        "software.haven.remove_header"?: boolean;
        [MSC4501_RELATES_TO_KEY]?: {
            rel_type?: string;
            event_id: string;
            room_id: string;
            sender: string;
            displayname?: string;
            // The entire original event's content, copied in as-is per MSC4501 — arbitrary keys
            // (formatted_body, format, media fields, anything else), not a fixed known shape.
            // Absent (undefined) when content_inline is true — see repostOf/replyTo derivation
            // below for the fallback to the outer event's own content in that case.
            content?: Record<string, unknown>;
            content_inline?: boolean;
        };
        "m.relates_to"?: {
            rel_type?: string;
            event_id?: string;
            "m.in_reply_to"?: { event_id: string };
        };
    }>();
    // content_inline: true means this event's own content doubles as the embedded snapshot of a
    // reposted/replied-to post too (see repostOfContent/replyCrossPostOfContent and displayContent
    // further down) - checked directly off the wire rather than via repostOf/replyCrossPostOf,
    // which aren't computed until further down and don't need duplicating just for this one check.
    // Used below to suppress the *outer* body/caption area entirely when content_inline (all of
    // that content already renders inside the repost/reply card instead - see suppressBoostBody) -
    // NOT to skip the org.matrix.msc4501.social.body/formatted_body override itself, which always
    // takes priority over stock body/formatted_body regardless of content_inline.
    const isContentInlineRelation = !!content[MSC4501_RELATES_TO_KEY]?.content_inline;
    // org.matrix.msc4501.social.body always takes priority over stock body when filled out (see
    // postBody.ts), used everywhere below EXCEPT the boost-permalink detection a few lines down,
    // which specifically wants the raw stock body (MSC4501's compat-fallback permalink lives there
    // regardless of whether a rich social.body caption also exists - see rawBody's own comment).
    const body = resolvePostBodyString(content);
    const rawBody = content.body ?? "";

    // m.in_reply_to — detect and strip the Matrix fallback quote from the body. Read off the wire
    // content, not the (possibly edit-substituted) `content` above - an edit's m.new_content never
    // re-declares the original m.relates_to, so reading it from `content` would silently drop the
    // "in reply to" indicator the moment this message gets edited.
    const inReplyToId =
        (event.getWireContent()?.["m.relates_to"] as { "m.in_reply_to"?: { event_id: string } } | undefined)?.[
            "m.in_reply_to"
        ]?.event_id ?? null;
    let displayBody = body;
    let replyFallbackSender: string | null = null;
    if (inReplyToId && body.startsWith("> ")) {
        replyFallbackSender = body.match(/^> <([^>]+)>/)?.[1] ?? null;
        displayBody = stripReplyFallback(body);
    }

    const relatesTo = content[MSC4501_RELATES_TO_KEY];
    const repostOf = relatesTo?.rel_type === MSC4501_REL_TYPE_REPOST ? relatesTo : undefined;
    const replyCrossPostOf = relatesTo?.rel_type === MSC4501_REL_TYPE_REPLY ? relatesTo : undefined;
    // content_inline: true means the outer event's own content *is* the embedded copy (no separate
    // relates_to.content sent) — used by e.g. a bridge that already builds one copy of the
    // reposted/replied-to content as this event's own content, rather than duplicating it into
    // relates_to.content too. Falls back to relates_to.content otherwise (the normal case).
    // resolvePostBody first, stripHavenHeader second - the header-strip works generically off
    // whatever's in .body/.formatted_body, so it needs to see the already-resolved (social.body/
    // social.formatted_body-preferred) fields, not the stock ones it'd otherwise strip instead.
    // The un-stripped/un-resolved source is kept around too (repostOfSourceContent/
    // replyCrossPostOfSourceContent) so hasPostBodyOverride can check it further down, to tell a
    // genuine MSC caption apart from content_inline's usual backwards-compat filler.
    //
    // content_inline reuses this whole event's own `content` as the embedded snapshot - but that
    // object also carries a field that describes *this* wrapper event itself, not the post being
    // reposted/replied to: its own relates_to (the repost/reply relation). Left in, it makes the
    // embedded snapshot look like it's itself a repost/reply of whatever it points at - most
    // visibly when this snapshot ends up standing in for the real target post (repostedMockEvent
    // below, used as resolveAndOpenPost's fallback while a knock-restricted room hasn't finished
    // syncing yet): the fallback gets rendered as a full post via SocialEventTile, which then
    // misreads the leftover relates_to as a genuine self-repost that never happened. Stripped here,
    // once, rather than at every downstream consumer.
    //
    // MSC4503 external_handle used to need the same treatment (a reposter/replier's own linked
    // Fediverse identity leaking onto the embedded original's ExternalHandleIcon) - no longer
    // relevant now that the icon is sourced from a live profile lookup keyed off the correct
    // sender (repostOf.sender/replyCrossPostOf.sender) rather than off this content object at all,
    // see repostedSenderProfile/replyCrossPostSenderProfile below.
    const withoutWrapperOnlyFields = <T extends Record<string, any> | undefined>(c: T): T => {
        if (!c || !(MSC4501_RELATES_TO_KEY in c)) return c;
        const { [MSC4501_RELATES_TO_KEY]: _relatesTo, ...rest } = c;
        return rest as T;
    };
    const repostOfSourceContent = repostOf?.content_inline ? withoutWrapperOnlyFields(content) : repostOf?.content;
    const repostOfContent = stripHavenHeader(resolvePostBody(repostOfSourceContent));
    const replyCrossPostOfSourceContent = replyCrossPostOf?.content_inline
        ? withoutWrapperOnlyFields(content)
        : replyCrossPostOf?.content;
    const replyCrossPostOfContent = stripHavenHeader(resolvePostBody(replyCrossPostOfSourceContent));
    // The outer event's own content can carry the same redundant header (e.g. a cross-posted
    // reply's own body opening with "⤵️ Reply to X's post:") when it's rendered directly as this
    // tile's main body below — Haven's own RepliedToProfileIndicator/PostRelationHeaderLine already
    // show the equivalent line, so strip it the same way as the embedded copies above. The
    // org.matrix.msc4501.social.body/formatted_body override always applies here too (same as
    // repostOfContent/replyCrossPostOfContent above) - when content_inline is true this ends up
    // resolving the exact same content those two do, which is fine: displayContent is never
    // actually *shown* in that case (suppressBoostBody unconditionally hides the outer body then,
    // since everything real already renders inside the repost/reply card instead).
    const displayContent = relatesTo ? stripHavenHeader(resolvePostBody(content)) : resolvePostBody(content);
    // A boost/retweet per MSC4501: the outer body is *only* a permalink to the reposted event
    // (rather than empty) so a non-compliant client still shows a normal clickable link instead of
    // a blank bubble. Detected by content_inline, or by parsing the body as a permalink and
    // checking it points at the same event relates_to references — anything else (real commentary,
    // or a link elsewhere) is a quote-post, even if that commentary happens to look like a URI.
    // Deliberately the raw stock body (rawBody), not the resolved one - MSC4501's compat-fallback
    // permalink is meant to live in stock body regardless of whether a rich social.body caption
    // also exists (see rawBody's own comment above).
    const repostPermalink = repostOf && !repostOf.content_inline ? parsePermalink(rawBody.trim()) : null;
    const isBoost = !!(
        repostOf &&
        (repostOf.content_inline ||
            (repostPermalink &&
                repostPermalink.eventId === repostOf.event_id &&
                repostPermalink.roomIdOrAlias === repostOf.room_id))
    );
    // A boost's own body is normally just the permalink above, so there's nothing worth rendering
    // as the main post body (BoostedIndicator's "reposted X's post" line covers it). But some
    // bridges also attach a real caption via formatted_body (e.g. an ActivityPub "boosted" note),
    // or via the MSC4501 social.body/social.formatted_body override fields (now also a plain-text
    // caption, not just HTML - stock body alone doesn't count, since for a non-inline boost that's
    // just the permalink per MSC4501, not real commentary) - show that instead of discarding it,
    // unless the bridge sets software.haven.remove_header to say its caption just duplicates
    // Haven's own header line. The MSC4501 override fields always count here, even when
    // content_inline (org.matrix.msc4501.social.body/formatted_body always trumps stock body/
    // formatted_body, no exceptions besides the raw-permalink check above) - whether this actually
    // ends up shown to the user is a separate question, handled by suppressBoostBody below, which
    // unconditionally hides the whole outer body area for a content_inline relation regardless of
    // what boostHasCaption computes here.
    const boostHasCaption =
        isBoost &&
        ((content.format === "org.matrix.custom.html" &&
            typeof content.formatted_body === "string" &&
            content.formatted_body.trim() !== "") ||
            (typeof content[MSC4501_FORMATTED_BODY_KEY] === "string" &&
                (content[MSC4501_FORMATTED_BODY_KEY] as string).trim() !== "") ||
            (typeof content[MSC4501_BODY_KEY] === "string" && (content[MSC4501_BODY_KEY] as string).trim() !== ""));
    // remove_header is backwards-compat only (see stripHavenHeader's own comment) - never
    // considered once the event carries either MSC4501 body override, regardless of caption state.
    // isContentInlineRelation is checked unconditionally (repost or cross-posted reply alike) -
    // content_inline means this same content object doubles as the embedded snapshot rendered in
    // the repost/reply card further down (see repostOfContent/replyCrossPostOfContent above), so
    // whatever it resolves to here belongs inside that card only, never duplicated into the outer
    // wrapper's own body area too.
    const suppressBoostBody =
        isContentInlineRelation ||
        (isBoost && (!boostHasCaption || (!hasPostBodyOverride(content) && !!content["software.haven.remove_header"])));

    // Live-resolve the reposted-from sender's current avatar/displayname instead of (or in
    // addition to) trusting repost_of's own embedded snapshot — see project memory for why avatar
    // has no embedded fallback at all, while displayname prefers live but still falls back.
    const repostedSenderProfile = useLiveUserProfile(client, repostOf?.sender);
    // Same live lookup for a cross-posted reply's own original author - used below for its own
    // ExternalHandleIcon, same reasoning as repostedSenderProfile's.
    const replyCrossPostSenderProfile = useLiveUserProfile(client, replyCrossPostOf?.sender);

    // Fallback for the post's own sender. Two distinct gaps this covers, not just one:
    // (1) room membership (event.sender) can be null even once membersLoaded() is confirmed true —
    //     e.g. a bridged/federated account that has since left the room it posted in, which no
    //     amount of loadMembersIfNeeded()/retrying can fix, since there's nothing left to load.
    // (2) sender can be a real, resolved RoomMember that's still missing a usable avatar/displayname
    //     — e.g. a bridge puppet whose own m.room.member content was never given an avatar_url/
    //     displayname (or was set before the bridge populated the account's real profile), even
    //     though the account's global profile has both. RoomMember.name/rawDisplayName silently
    //     fall back to the raw MXID in this case, so sender existing isn't proof it has a real name.
    // A live profile lookup is room-independent, so it covers both — fetched unconditionally (not
    // just when sender is null) and used to fill in whichever of avatar/name sender's own room
    // membership didn't actually provide.
    const liveSenderProfile = useLiveUserProfile(client, event.getSender() ?? undefined);
    const senderAvatarMxc = sender?.getMxcAvatarUrl() || liveSenderProfile?.avatarUrl;
    const senderHasRealName = !!sender && sender.rawDisplayName !== sender.userId;
    const senderDisplayName =
        (senderHasRealName ? sender!.rawDisplayName : null) ||
        liveSenderProfile?.displayName ||
        event.getSender() ||
        undefined;

    // Renders content.formatted_body (sanitized HTML incl. user/room pills) the same way
    // Element's own message tiles do, falling back to the plain body when unformatted.
    const eventContentBodyVm = useCreateAutoDisposedViewModel(
        () =>
            new EventContentBodyViewModel({
                as: "div",
                includeDir: false,
                mxEvent: event,
                content: displayContent,
                stripReply: !!inReplyToId,
                linkify: true,
                renderMentionPills: true,
                client,
            }),
    );
    useEffect(() => {
        eventContentBodyVm.setEventContent(event, displayContent);
    }, [event, displayContent, eventContentBodyVm]);
    useEffect(() => {
        eventContentBodyVm.setStripReply(!!inReplyToId);
    }, [inReplyToId, eventContentBodyVm]);

    // Renders the embedded repost_of.content the exact same way as the main post body above (full
    // formatted_body/media/pill support per MSC4501 — "renders identically to how the original was
    // authored, not just as a plain-text stand-in") — a synthetic MatrixEvent standing in for the
    // original, since we may have no live event to render (that's the whole point of embedding it).
    const repostedMockEvent = useMemo(
        () =>
            new MatrixEvent({
                type: "m.room.message",
                sender: repostOf?.sender,
                content: repostOfContent ?? {},
                event_id: repostOf?.event_id,
                room_id: repostOf?.room_id,
                origin_server_ts: event.getTs(),
            }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [repostOf, repostOfContent],
    );
    const repostedBodyVm = useCreateAutoDisposedViewModel(
        () =>
            new EventContentBodyViewModel({
                as: "div",
                includeDir: false,
                mxEvent: repostedMockEvent,
                content: repostOfContent ?? {},
                stripReply: false,
                linkify: true,
                renderMentionPills: true,
                client,
            }),
    );
    useEffect(() => {
        repostedBodyVm.setEventContent(repostedMockEvent, repostOfContent ?? {});
    }, [repostedMockEvent, repostOfContent, repostedBodyVm]);

    // Same idea as repostedMockEvent/repostedBodyVm above, but for a reply cross-posted into a
    // profile feed (rel_type: m.social.reply) — renders the original post being replied to, above
    // the reply's own real text (see the "replied to" indicator rendered further down).
    const replyCrossPostMockEvent = useMemo(
        () =>
            new MatrixEvent({
                type: "m.room.message",
                sender: replyCrossPostOf?.sender,
                content: replyCrossPostOfContent ?? {},
                event_id: replyCrossPostOf?.event_id,
                room_id: replyCrossPostOf?.room_id,
                origin_server_ts: event.getTs(),
            }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [replyCrossPostOf, replyCrossPostOfContent],
    );
    const replyCrossPostBodyVm = useCreateAutoDisposedViewModel(
        () =>
            new EventContentBodyViewModel({
                as: "div",
                includeDir: false,
                mxEvent: replyCrossPostMockEvent,
                content: replyCrossPostOfContent ?? {},
                stripReply: false,
                linkify: true,
                renderMentionPills: true,
                client,
            }),
    );
    useEffect(() => {
        replyCrossPostBodyVm.setEventContent(replyCrossPostMockEvent, replyCrossPostOfContent ?? {});
    }, [replyCrossPostMockEvent, replyCrossPostOfContent, replyCrossPostBodyVm]);

    const isLegacyMessage = event.getType() === "m.room.message";
    const isNativePost = event.getType() === MSC4501_EVENT_POST;
    const isPollMessage = M_POLL_START.matches(event.getType());
    if (!isLegacyMessage && !isNativePost && !isPollMessage) return null;
    if (!isPollMessage && !body && !content.file && !content.url) return null;

    // m.audio (plain file uploads and voice messages), m.location, and polls all get the exact
    // same stock components the normal room timeline uses (via MessageEvent, which picks
    // MAudioBody vs MVoiceMessageBody vs MLocationBody vs MPollBody itself) instead of a bespoke
    // <audio> tag, no rendering at all, or a hand-rolled results UI.
    const isAudioMessage = isLegacyMessage && content.msgtype === MsgType.Audio;
    const isLocationMessage = isLegacyMessage && content.msgtype === MsgType.Location;

    const ts = event.getTs();
    const displayTs = ts ? (forceFullTimestamp ? formatFullTimestamp(ts) : formatTimestamp(ts)) : "";
    const fullTs = ts ? formatFullTimestamp(ts) : "";

    // replacingEventId() is set once matrix-js-sdk has aggregated an m.replace relation onto this
    // event - the same check stock Element's own "(edited)" marker uses. The edit event itself
    // never reaches this component (SocialHomeView/SocialRoomView's feed filters exclude it), so
    // `event` here is always the original, and event.getContent() is already showing its latest
    // edited body - this just surfaces that fact to the user with a marker to open the history.
    const isEdited = !!event.replacingEventId();
    function handleEditedMarkerClick(e: React.MouseEvent): void {
        e.stopPropagation();
        Modal.createDialog(MessageEditHistoryDialog, { mxEvent: event });
    }

    // File attachment rendering. Handles both the custom `content.file` shape used by
    // our own posts/comments, and the standard m.room.message media shape
    // (content.url + content.info.mimetype for msgtypes m.image/m.video/m.audio/m.file)
    // used by ordinary messages sent by any Matrix client.
    const fileUrl = content.file?.url ?? content.url;
    // Per the m.room.message media spec, `filename` holds the original file name and `body`
    // becomes a user-supplied caption when it differs from `filename`. Older clients that don't
    // support captions omit `filename` and just put the file name straight in `body`.
    const fileName = content.file?.name ?? content.filename ?? (content.url ? body : "");
    const fileMime =
        content.file?.mimetype ??
        content.info?.mimetype ??
        (content.url
            ? { "m.image": "image/*", "m.video": "video/*", "m.audio": "audio/*" }[content.msgtype ?? ""] ?? ""
            : "");
    const httpFileUrl = fileUrl ? client.mxcUrlToHttp(fileUrl) : null;

    // Shared by the main post's own image, and the embedded repost/reply-cross-post cards' images
    // below - same stock lightbox (ImageView) either way, just pointed at whichever image/mxEvent/
    // ref is actually being clicked.
    function openImageLightbox(
        e: React.MouseEvent,
        httpUrl: string | null,
        name: string,
        mxEvent: MatrixEvent,
        ref: React.RefObject<HTMLImageElement | null>,
    ): void {
        e.stopPropagation(); // don't trigger article click → thread view
        if (!httpUrl) return;
        const params: any = { src: httpUrl, name, mxEvent };
        if (ref.current) {
            const rect = ref.current.getBoundingClientRect();
            params.thumbnailInfo = {
                width: rect.width,
                height: rect.height,
                positionX: rect.left,
                positionY: rect.top,
            };
        }
        Modal.createDialog(ImageView, params, "mx_Dialog_lightbox", undefined, true);
    }

    function handleImageClick(e: React.MouseEvent): void {
        openImageLightbox(e, httpFileUrl, fileName || body || "Image", event, imgRef);
    }

    let fileNode: React.ReactNode = null;
    if (isPollMessage) {
        // No stopPropagation here (unlike audio/location below) - a poll's only real interactive
        // elements are its <input type="radio"> options, which handleArticleClick's own
        // target.closest("button, a, input, ...") check already excludes from navigating. Blanket-
        // stopping propagation over the whole poll would make every non-interactive part of it (the
        // question text, the vote counts, the gaps between options) a dead click zone that still
        // shows the card's hover-highlight, since that's plain CSS unrelated to this handler.
        fileNode = (
            <div className="social_EventTile_mediaWrap">
                <MessageEvent mxEvent={event} />
            </div>
        );
    } else if (isLocationMessage) {
        fileNode = (
            <div className="social_EventTile_mediaWrap" onClick={(e) => e.stopPropagation()}>
                <MessageEvent mxEvent={event} />
            </div>
        );
    } else if (httpFileUrl) {
        if (isAudioMessage) {
            // MessageEvent picks MAudioBody or MVoiceMessageBody itself (via isVoiceMessage), so
            // both plain audio-file posts and voice-message posts get the exact stock player.
            fileNode = (
                <div className="social_EventTile_mediaWrap" onClick={(e) => e.stopPropagation()}>
                    <RoomContext.Provider value={stockMediaRoomContext}>
                        <MessageEvent mxEvent={event} />
                    </RoomContext.Provider>
                </div>
            );
        } else if (fileMime.startsWith("image/")) {
            fileNode = (
                <div className="social_EventTile_mediaWrap">
                    <img
                        ref={imgRef}
                        src={httpFileUrl}
                        alt={fileName}
                        className="social_EventTile_image"
                        onClick={handleImageClick}
                    />
                </div>
            );
        } else if (fileMime.startsWith("video/")) {
            fileNode = (
                <div className="social_EventTile_mediaWrap" onClick={(e) => e.stopPropagation()}>
                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                    <video src={httpFileUrl} controls className="social_EventTile_video" />
                </div>
            );
        } else {
            fileNode = (
                <div className="social_EventTile_attachment" onClick={(e) => e.stopPropagation()}>
                    <a
                        href={httpFileUrl}
                        download={fileName}
                        className="social_EventTile_attachmentLink"
                    >
                        📎 {fileName}
                    </a>
                </div>
            );
        }
    }

    // URL preview: extract the first URL from the body when no file is attached. Skipped for a
    // detected boost — its body is only a matrix.to/matrix: permalink to the boosted event (see
    // isBoost above), not a real shared link, so previewing it would just be a redundant card
    // under the repost card that already renders the actual boosted content.
    const firstUrl = !fileUrl && !isBoost ? extractFirstUrl(body) : null;

    // Clicking the article navigates to the thread view, unless the click
    // originated from an interactive element (button, link, input).
    function handleArticleClick(e: React.MouseEvent): void {
        if (!onViewThread) return;
        const target = e.target as HTMLElement;
        if (target.closest("button, a, input, textarea, [role='button']")) return;
        // Scoped to THIS article specifically - checking merely "is there any selection anywhere on
        // the page" meant a stale selection left over from selecting text in a completely different
        // card (or a poll option's label, or anywhere else) silently blocked every click on every
        // other post until something happened to clear it, with no visual sign why (the hover
        // highlight still showed normally, since that's plain CSS unrelated to this check).
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && sel.toString().length > 0 && e.currentTarget.contains(sel.anchorNode)) return;

        // Navigate straight to this event, not some assumed "root" - SocialPostView resolves the
        // real ancestor chain itself (walking m.thread's event_id, which is only ever the
        // *immediate* parent per Haven's own convention, not necessarily the true root - see its
        // findThreadAncestors), and shows this event properly positioned in it either way.
        onViewThread(event, room);
    }

    // The timestamp is a real matrix.to permalink to this event (so right-click "copy link
    // address"/middle-click-to-open-in-new-tab work like any other link) - clicking it plainly
    // stays in Social, same as clicking the article body itself (handleArticleClick above), since
    // this room is already known to be a Social one. Shift forces stock Element room mode instead,
    // matching the same convention every other matrix.to link in Haven follows (see
    // permalinkRouting.ts) - a plain Action.ViewRoom dispatch here rather than that module's own
    // tryRouteSocialRoom, since there's no "is this a social room?" to resolve: it's this one.
    function handleTimestampClick(e: React.MouseEvent): void {
        e.stopPropagation();
        e.preventDefault();
        if (e.shiftKey) {
            defaultDispatcher.dispatch<ViewRoomPayload>({
                action: Action.ViewRoom,
                room_id: room.roomId,
                event_id: eventId,
                highlighted: true,
                metricsTrigger: undefined,
            });
            return;
        }
        onViewThread?.(event, room);
    }

    // Matrix permalinks (matrix.to links to a room/user/event) in the formatted body should
    // navigate within Element, the same way they do in the normal timeline, instead of opening
    // matrix.to. Mirrors TextualBodyViewModel.onRootClick.
    function handleBodyClick(e: React.MouseEvent<HTMLDivElement>): void {
        // A user-mention pill's own onClick (usePermalink.ts) already called preventDefault +
        // dispatched Action.ViewUser by the time this bubbles up here — don't also redirect via
        // hash, which would double up with (and could race) that navigation. Event/room pills have
        // no onClick of their own (see usePermalink.ts) and fall through to the same hash-based
        // navigation as a plain matrix.to link, same as stock TextualBodyViewModel.onRootClick.
        // stopPropagation here too (not just when this function's own logic below fires) - this div
        // may be nested inside a repost/quoted card's own onClick (handleRepostCardClick /
        // handleQuotedCardClick), which would otherwise still fire on the bubble and navigate to the
        // reposted post's own thread instead of respecting whatever the pill click just did.
        if (e.defaultPrevented) {
            e.stopPropagation();
            return;
        }
        let target = e.target as HTMLElement | null;
        if ((target as HTMLElement | null)?.dataset?.[LINKIFIED_DATA_ATTRIBUTE]) return;
        if (target?.nodeName !== "A") target = target?.closest("a") ?? null;
        if (!target) return;

        const href = (target as HTMLAnchorElement).href;

        // An event permalink into one of our own profile/group rooms should open that room's
        // Social page instead of switching back to the regular room timeline to show the raw
        // event — see MSC4501.
        const parts = parsePermalink(href);

        // A user permalink/pill should always navigate to their Social profile (or the "no
        // profile" placeholder), same as clicking their name elsewhere — never fall through to
        // the default hash-based navigation below, which would kick the app out of Social into
        // regular chat mode to show that user. Covers a pill whose RoomMember never resolved
        // (see usePermalink.ts — its onClick is only wired once member resolves, so an
        // unresolved pill's click reaches here unprevented) just as much as a bare matrix.to user
        // link with no pill at all; SocialHomeView's own Action.ViewUser listener only ever
        // catches the resolved-pill case.
        if (parts?.userId && onViewUser) {
            e.preventDefault();
            e.stopPropagation();
            onViewUser(parts.userId);
            return;
        }

        // Was a hand-rolled, synchronous-only version of this exact check before (fixed) - only
        // ever recognized a target room as social if client.getRoom() already had it loaded
        // locally, so on a fresh cache/session (this room not yet synced in, even though it's a
        // real Social room the summary check below would confirm) it silently fell straight
        // through to the plain hash-navigation fallback below, landing in the regular Element room
        // view instead of Social. tryRouteSocialPermalink is the shared, more robust version used
        // everywhere else a permalink can be clicked (room topics, Linkify) - it has that same
        // fast synchronous path, but also retries via an async room-summary check (MSC3266) for a
        // room that isn't loaded locally yet, exactly the case that was falling through here.
        if (tryRouteSocialPermalink(e, href)) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        const localHref = tryTransformPermalinkToLocalHref(href);
        if (localHref !== href) {
            e.preventDefault();
            e.stopPropagation();
            window.location.hash = localHref;
        }
    }

    return (
        <article
            className={`social_EventTile${onViewThread ? " social_EventTile--clickable" : ""}`}
            onClick={handleArticleClick}
        >
            {/* Room name badge — top-left, X/Twitter community style */}
            {!hideRoomName && (
                <div className="social_EventTile_roomLabel">
                    {onRoomClick ? (
                        <button
                            className="social_EventTile_roomLabelBtn"
                            onClick={(e) => { e.stopPropagation(); handleRoomClick(); }}
                        >
                            {room.name}
                        </button>
                    ) : (
                        <span className="social_EventTile_roomLabelText">{room.name}</span>
                    )}
                </div>
            )}

            {/* Header: avatar + sender info + timestamp + "..." menu */}
            <div className="social_EventTile_header">
                <button
                    className="social_EventTile_avatarBtn"
                    onClick={(e) => {
                        e.stopPropagation();
                        onOpenUserPanel?.(event.getSender() ?? "", room);
                    }}
                    title={event.getSender() ?? undefined}
                >
                    {sender?.getMxcAvatarUrl() ? (
                        <MemberAvatar member={sender} size="40px" />
                    ) : (
                        <BaseAvatar
                            name={senderDisplayName ?? "?"}
                            idName={event.getSender() ?? undefined}
                            url={senderAvatarMxc ? (client.mxcUrlToHttp(senderAvatarMxc, 40, 40, "crop") ?? undefined) : undefined}
                            size="40px"
                        />
                    )}
                </button>
                <div className="social_EventTile_sender">
                    <button
                        className={`social_EventTile_senderName ${colorClassForId(event.getSender() ?? "")}`}
                        onClick={(e) => { e.stopPropagation(); onViewUser?.(event.getSender() ?? ""); }}
                        title={event.getSender() ?? undefined}
                    >
                        {senderDisplayName}
                    </button>
                    <ExternalHandleIcon externalHandle={liveSenderProfile?.externalHandle} />
                </div>
                {isEdited && (
                    <button
                        className="social_EventTile_editedMarker"
                        onClick={handleEditedMarkerClick}
                        title="View edit history"
                    >
                        <EditIcon />
                        Edited
                    </button>
                )}
                {eventId ? (
                    <a
                        href={new RoomPermalinkCreator(room).forEvent(eventId)}
                        className="social_EventTile_timestampLink"
                        onClick={handleTimestampClick}
                    >
                        <time
                            className="social_EventTile_timestamp"
                            dateTime={new Date(ts).toISOString()}
                            title={fullTs}
                        >
                            {displayTs}
                        </time>
                    </a>
                ) : (
                    <time
                        className="social_EventTile_timestamp"
                        dateTime={new Date(ts).toISOString()}
                        title={fullTs}
                    >
                        {displayTs}
                    </time>
                )}

                {/* "..." menu — the exact same MessageContextMenu used for messages in the stock
                    room timeline, so every option it offers (view source, pin, forward, etc.)
                    comes for free instead of us reimplementing a subset of it. */}
                <div className="social_EventTile_menuWrap">
                    <button
                        ref={menuHandle}
                        className="social_EventTile_menuBtn"
                        onClick={(e) => { e.stopPropagation(); openMenu(); }}
                        aria-label="Post options"
                        aria-haspopup="true"
                        aria-expanded={menuDisplayed}
                    >
                        ⋯
                    </button>
                    {menuDisplayed && menuHandle.current && (
                        <SocialMessageContextMenu
                            {...toRightOf(menuHandle.current.getBoundingClientRect())}
                            mxEvent={event}
                            permalinkCreator={new RoomPermalinkCreator(room)}
                            onFinished={closeMenu}
                        />
                    )}
                </div>
            </div>

            {/* "In reply to" indicator (when m.in_reply_to is present) */}
            {inReplyToId && (
                <RepliedToIndicator
                    eventId={inReplyToId}
                    room={room}
                    fallbackSender={replyFallbackSender}
                    onViewThread={onViewThread}
                />
            )}

            {/* "Replied to" indicator for a cross-posted reply (rel_type: m.social.reply) — this
                event's own body is the reply's own real text (rendered normally below, unaffected)
                — the quoted original it's replying to renders in its own card further down. */}
            {replyCrossPostOf && (
                <RepliedToProfileIndicator
                    eventId={replyCrossPostOf.event_id}
                    roomId={replyCrossPostOf.room_id}
                    originalSenderName={replyCrossPostOf.displayname ?? replyCrossPostOf.sender}
                    embedded={
                        replyCrossPostOfContent
                            ? {
                                  sender: replyCrossPostOf.sender,
                                  displayname: replyCrossPostOf.displayname,
                                  // Same media-vs-text content_inline reasoning as the quote card's
                                  // own body further down: only a MEDIA post's content_inline body
                                  // is just backwards-compat filler - a plain-text quoted reply's
                                  // content_inline body is the whole original post. A genuine
                                  // MSC4501 body/formatted_body override is never filler though
                                  // (see hasPostBodyOverride) - always show that regardless of media.
                                  body:
                                      replyCrossPostOf.content_inline &&
                                      !hasPostBodyOverride(replyCrossPostOfSourceContent) &&
                                      ((replyCrossPostOfContent as { url?: string; file?: { url: string } }).url ||
                                          (replyCrossPostOfContent as { url?: string; file?: { url: string } }).file
                                              ?.url)
                                          ? undefined
                                          : (replyCrossPostOfContent as { body?: string }).body,
                              }
                            : undefined
                    }
                    onViewThread={onViewThread}
                />
            )}

            {/* Post body — suppressed for plain media messages where the "body" is just the filename,
                for location messages and polls (MessageEvent's MLocationBody/MPollBody below is the
                whole body, same as the stock room timeline), and for a detected boost with no real
                caption of its own (its body is only a permalink, per MSC4501 — not meant to be read
                as commentary; see the "Reposted" label below instead) — unless it has a
                real caption worth keeping (HTML or plain-text), see boostHasCaption above. */}
            {displayBody && !suppressBoostBody && !(content.url && displayBody === fileName) && !isLocationMessage && !isPollMessage && (
                <div key={pillsGeneration} className="social_EventTile_body" onClick={handleBodyClick}>
                    <EventContentBodyView vm={eventContentBodyVm} as="div" />
                </div>
            )}

            {/* Embedded reposted post (m.social.repost_of — covers boosts, retweets, and quote-posts).
                Body/formatted_body render via repostedBodyVm — the same EventContentBodyView
                machinery as the main post above — rather than a plain-text stand-in, per MSC4501.
                Media detection below only covers the two shapes SocialEventTile already knows how
                to render (custom `file`, and standard m.room.message url/info); repostOf.content
                itself still carries every field from the original regardless of which of those
                this component bothers to specially render, same limitation the main post has. */}
            {repostOf && (
                <BoostedIndicator
                    eventId={repostOf.event_id}
                    roomId={repostOf.room_id}
                    originalSenderName={repostedSenderProfile?.displayName || repostOf.displayname || "unknown"}
                    embedded={
                        repostOfContent
                            ? {
                                  sender: repostOf.sender,
                                  displayname: repostOf.displayname,
                                  // Same media-vs-text content_inline reasoning as the repost card's
                                  // own body below: only a MEDIA post's content_inline body is just
                                  // backwards-compat filler (a filename/permalink) - a plain-text
                                  // repost's content_inline body is the whole original post. A
                                  // genuine MSC4501 body/formatted_body override is never filler
                                  // though (see hasPostBodyOverride) - always show that regardless
                                  // of media.
                                  body:
                                      repostOf.content_inline &&
                                      !hasPostBodyOverride(repostOfSourceContent) &&
                                      ((repostOfContent as { url?: string; file?: { url: string } }).url ||
                                          (repostOfContent as { url?: string; file?: { url: string } }).file?.url)
                                          ? undefined
                                          : (repostOfContent as { body?: string }).body,
                              }
                            : undefined
                    }
                    onViewThread={onViewThread}
                />
            )}
            {repostOf && (() => {
                // repostOfContent can be missing (older data sent before this schema existed, or a
                // malformed content_inline: true with nothing to actually fall back to) — fall
                // back to {} rather than crashing on it.
                const repostedMedia = (repostOfContent ?? {}) as {
                    body?: string;
                    url?: string;
                    filename?: string;
                    info?: { mimetype?: string };
                    file?: { url: string; name: string; mimetype: string };
                };
                const repostedFileUrl = repostedMedia.file?.url ?? repostedMedia.url;
                const repostedHttpUrl = repostedFileUrl ? client.mxcUrlToHttp(repostedFileUrl) : null;
                const repostedMime = repostedMedia.file?.mimetype ?? repostedMedia.info?.mimetype ?? "";
                // Clicking the card navigates to the reposted post itself (same target
                // BoostedIndicator's own link above already uses for a boost) rather than
                // swallowing the click entirely - only genuinely interactive children (the media
                // player, an image opening its lightbox) still need their own stopPropagation,
                // which they already have further down.
                const handleRepostCardClick = (e: React.MouseEvent): void => {
                    if (!onViewThread) return;
                    // Reposts/boosts exist precisely to surface content from rooms the viewer likely
                    // hasn't joined - the original bug here required client.getRoom() to already
                    // have it, which silently did nothing for exactly the common case, and worse,
                    // let the click bubble up to the outer article's own onViewThread (opening the
                    // repost's own thread instead of the reposted post). stopPropagation
                    // unconditionally up front prevents that regardless of what
                    // resolveAndOpenPost below ends up doing (peek/join/knock/private modal).
                    e.stopPropagation();
                    resolveAndOpenPost(client, repostOf.room_id, repostOf.event_id, repostedMockEvent, onViewThread);
                };
                return (
                    <div
                        className={`social_EventTile_repostCard${onViewThread ? " social_EventTile_repostCard--clickable" : ""}`}
                        onClick={handleRepostCardClick}
                    >
                        <div className="social_EventTile_repostCard_header">
                            {repostedSenderProfile?.avatarUrl && (
                                <img
                                    className="social_EventTile_repostCard_avatar"
                                    src={client.mxcUrlToHttp(repostedSenderProfile.avatarUrl, 24, 24, "crop") ?? ""}
                                    alt=""
                                />
                            )}
                            <span className="social_EventTile_repostCard_sender">
                                {repostedSenderProfile?.displayName || repostOf.displayname || repostOf.sender}
                            </span>
                            <ExternalHandleIcon externalHandle={repostedSenderProfile?.externalHandle} />
                        </div>
                        {/* For a MEDIA post (repostedFileUrl below), content_inline's body is
                            usually the *outer* boost event's own MSC4501 backwards-compat fallback
                            text (a filename or plain permalink) - not a real caption - UNLESS a
                            genuine org.matrix.msc4501.social.body/formatted_body override is
                            present (hasPostBodyOverride), which always trumps stock body/
                            formatted_body and is never filler, media or not. For a plain TEXT
                            repost (no media at all), content_inline's body genuinely *is* the whole
                            original post - there's nothing else it could be showing instead - just
                            with a trailing backwards-compat permalink appended for non-MSC4501
                            clients that EventContentBodyView won't even render (it prefers
                            formatted_body, which never includes that trailing link, over the plain
                            body used here only to decide whether to render anything at all).
                            Wrongly hiding this too (matching the media case) is what made a
                            plain-text repost's card show just the sender name with no content
                            underneath. */}
                        {repostedMedia.body &&
                            (!repostOf.content_inline ||
                                !repostedFileUrl ||
                                hasPostBodyOverride(repostOfSourceContent)) && (
                            <div className="social_EventTile_repostCard_body" onClick={handleBodyClick}>
                                <EventContentBodyView vm={repostedBodyVm} as="div" />
                            </div>
                        )}
                        {repostedHttpUrl &&
                            (repostedMime.startsWith("image/") ? (
                                <div className="social_EventTile_repostCard_media">
                                    <img
                                        ref={repostImgRef}
                                        src={repostedHttpUrl}
                                        alt={repostedMedia.file?.name ?? repostedMedia.filename ?? ""}
                                        className="social_EventTile_repostCard_image"
                                        onClick={(e) =>
                                            openImageLightbox(
                                                e,
                                                repostedHttpUrl,
                                                repostedMedia.file?.name ?? repostedMedia.filename ?? repostedMedia.body ?? "Image",
                                                repostedMockEvent,
                                                repostImgRef,
                                            )
                                        }
                                    />
                                </div>
                            ) : repostedMime.startsWith("video/") ? (
                                <div className="social_EventTile_repostCard_media" onClick={(e) => e.stopPropagation()}>
                                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                                    <video
                                        src={repostedHttpUrl}
                                        controls
                                        className="social_EventTile_repostCard_video"
                                    />
                                </div>
                            ) : null)}
                    </div>
                );
            })()}

            {/* Quoted original for a cross-posted reply (rel_type: m.social.reply) — same card
                treatment as a repost/quote-post's own embedded original, per MSC4501 ("using
                relates_to.content for the referenced post the same way a quote-post does"). */}
            {replyCrossPostOf && (() => {
                const quotedMedia = (replyCrossPostOfContent ?? {}) as {
                    body?: string;
                    url?: string;
                    filename?: string;
                    info?: { mimetype?: string };
                    file?: { url: string; name: string; mimetype: string };
                };
                const quotedFileUrl = quotedMedia.file?.url ?? quotedMedia.url;
                const quotedHttpUrl = quotedFileUrl ? client.mxcUrlToHttp(quotedFileUrl) : null;
                const quotedMime = quotedMedia.file?.mimetype ?? quotedMedia.info?.mimetype ?? "";
                const handleQuotedCardClick = (e: React.MouseEvent): void => {
                    if (!onViewThread) return;
                    // See handleRepostCardClick's own comment above for why this can't require
                    // client.getRoom() to already have the room, and why stopPropagation needs to
                    // run unconditionally up front rather than only once a target room is found.
                    e.stopPropagation();
                    resolveAndOpenPost(
                        client,
                        replyCrossPostOf.room_id,
                        replyCrossPostOf.event_id,
                        replyCrossPostMockEvent,
                        onViewThread,
                    );
                };
                return (
                    <div
                        className={`social_EventTile_repostCard${onViewThread ? " social_EventTile_repostCard--clickable" : ""}`}
                        onClick={handleQuotedCardClick}
                    >
                        <div className="social_EventTile_repostCard_header">
                            <span className="social_EventTile_repostCard_sender">
                                {replyCrossPostOf.displayname || replyCrossPostOf.sender}
                            </span>
                            <ExternalHandleIcon externalHandle={replyCrossPostSenderProfile?.externalHandle} />
                        </div>
                        {/* Same media-vs-text content_inline reasoning as the repost card above -
                            only hide this body when there's real media (quotedFileUrl) to show
                            instead and no genuine MSC4501 body/formatted_body override
                            (hasPostBodyOverride) is present; a plain-text quoted reply's
                            content_inline body is the whole original post, not just
                            backwards-compat filler, and an override always trumps regardless of
                            media. */}
                        {quotedMedia.body &&
                            (!replyCrossPostOf.content_inline ||
                                !quotedFileUrl ||
                                hasPostBodyOverride(replyCrossPostOfSourceContent)) && (
                            <div className="social_EventTile_repostCard_body" onClick={handleBodyClick}>
                                <EventContentBodyView vm={replyCrossPostBodyVm} as="div" />
                            </div>
                        )}
                        {quotedHttpUrl &&
                            (quotedMime.startsWith("image/") ? (
                                <div className="social_EventTile_repostCard_media">
                                    <img
                                        ref={quotedImgRef}
                                        src={quotedHttpUrl}
                                        alt={quotedMedia.file?.name ?? quotedMedia.filename ?? ""}
                                        className="social_EventTile_repostCard_image"
                                        onClick={(e) =>
                                            openImageLightbox(
                                                e,
                                                quotedHttpUrl,
                                                quotedMedia.file?.name ?? quotedMedia.filename ?? quotedMedia.body ?? "Image",
                                                replyCrossPostMockEvent,
                                                quotedImgRef,
                                            )
                                        }
                                    />
                                </div>
                            ) : quotedMime.startsWith("video/") ? (
                                <div className="social_EventTile_repostCard_media" onClick={(e) => e.stopPropagation()}>
                                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                                    <video src={quotedHttpUrl} controls className="social_EventTile_repostCard_video" />
                                </div>
                            ) : null)}
                    </div>
                );
            })()}

            {/* Embedded media or download link — suppressed for a detected boost, since some
                bridges (e.g. the ActivityPub bridge) copy the boosted event's own attachment onto
                the outer event's content too, not just into repost_of.content, which would
                otherwise render the same image/video twice: once here, once in the repost card
                above. */}
            {!isBoost && fileNode}

            {/* Rich URL preview when no file is attached */}
            {!isBoost && firstUrl && <UrlPreview url={firstUrl} ts={ts} />}

            <div onClick={(e) => e.stopPropagation()}>
                <SocialReactionsRow
                    client={client}
                    mxEvent={event}
                    reactions={reactions}
                    canReact={canReact}
                    canSelfRedact={canSelfRedact}
                />
            </div>

            {/* Action bar - icon-only (see social_EventTile_actionBtn/social_LikeButton's own CSS):
                counts always show next to Reply's icon, Repost's icon (👍/🔁 reactions.md convention
                - see repostReactionCount above), and Like's (via LikeButton's own count prop) when
                > 0. These are each button's own single source of truth for that number now -
                SocialReactionsRow filters both 👍 and 🔁 out of its own pills to avoid showing the
                same count twice. */}
            <div className="social_EventTile_actions" onClick={(e) => e.stopPropagation()}>
                <button
                    className="social_EventTile_actionBtn"
                    onClick={openReplyDialog}
                    aria-label="Reply"
                    title="Reply"
                >
                    <ReplyIcon />
                    {replyCount > 0 && <span>{replyCount}</span>}
                </button>

                <button
                    className={`social_EventTile_actionBtn${isReposted ? " social_EventTile_actionBtn--reposted" : ""}`}
                    onClick={() => void handleBoost()}
                    aria-label={isReposted ? "Reposted, click to undo" : "Repost"}
                    title={isReposted ? "Reposted, click to undo" : "Repost"}
                    disabled={boostBusy}
                >
                    <RestartIcon />
                    {repostReactionCount > 0 && <span>{repostReactionCount}</span>}
                </button>

                <button
                    className="social_EventTile_actionBtn"
                    onClick={openRepostDialog}
                    aria-label="Quote post"
                    title="Quote post"
                >
                    <span style={{ fontSize: 18 }}>❝</span>
                </button>

                <LikeButton
                    event={event}
                    isLiked={isLiked}
                    count={likeReactionCount}
                    onLike={handleLike}
                    onReact={handleReact}
                    disabled={likeBusy || !onLike}
                />
            </div>

        </article>
    );
}

// Some bridges set "software.haven.remove_header": true on a repost/cross-posted-reply event to
// signal that its own body/formatted_body already opens with a preamble line describing the
// relation (e.g. "🔁 X boosted Y's post:", "⤵️ Reply to X's post:") — redundant once rendered next
// to Haven's own equivalent header (PostRelationHeaderLine's green "🔁 X reposted" line outside a
// repost card, or RepliedToProfileIndicator's own line above a cross-posted reply's real text).
// Strips that leading line - a single top-level <p>...</p> in formatted_body (since that's the
// shape every bridge producing this flag has actually sent) plus any immediately-following blank
// line/<br>, or the equivalent single text line plus blank line(s) in plain body - leaving only the
// real content (mentions, media, the post's own text) visible.
// body is left untouched only for a boost/retweet's own outer content specifically: there, per
// MSC4501, body is just a bare permalink fallback for non-HTML clients (see isBoost's own doc),
// never a mirror of formatted_body's text, so stripping it would break that fallback rather than
// remove a header. Detected generically (not by call site) via parsePermalink, since that's the same
// check isBoost itself uses to tell a boost's permalink-only body apart from real text.
// Backwards-compat only, per the latest MSC4501 revision: remove_header predates
// org.matrix.msc4501.social.body/formatted_body existing at all - a sender using either of those
// has no redundant header text in body/formatted_body left to strip in the first place, so the
// flag is never even considered once one is present (see hasPostBodyOverride below), regardless of
// what it's set to. Still honored for events that already carry it with neither new field, to keep
// working with content already out there - not meant to be relied on by anything sent from now on,
// and worth deleting outright later once nothing still needs it.
function stripHavenHeader<T extends Record<string, any> | undefined>(content: T): T {
    if (!content?.["software.haven.remove_header"]) return content;
    // Backwards compat only: remove_header predates org.matrix.msc4501.social.body/formatted_body
    // - a sender using those has no redundant header text left in stock body/formatted_body to
    // strip in the first place, and shouldn't need to set this flag at all going forward. Still
    // honored for older events that already have it set and nothing else, phased out later once
    // nothing in the wild still relies on it.
    if (hasPostBodyOverride(content)) return content;
    const stripped: Record<string, any> = { ...content };
    if (typeof stripped.formatted_body === "string") {
        stripped.formatted_body = stripped.formatted_body.replace(/^\s*<p>.*?<\/p>\s*(<br\s*\/?>\s*)*/is, "");
    }
    if (typeof stripped.body === "string" && !parsePermalink(stripped.body.trim())) {
        stripped.body = stripped.body.replace(/^[^\n]*\n(?:[ \t]*\n)*/, "");
    }
    return stripped as T;
}

function extractFirstUrl(text: string): string | null {
    const matches = text.match(/https?:\/\/[^\s<>"',;!?)\]]+/g);
    if (!matches) return null;
    // Skip matrix.to permalinks — those are pills/navigation, not link-preview material.
    return matches.find((url) => {
        try {
            return new URL(url).hostname.toLowerCase() !== "matrix.to";
        } catch {
            return false;
        }
    }) ?? null;
}

function formatTimestamp(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Full date/time, e.g. "Jul 8, 2026, 2:41 PM" - used both for the focused post/thread root's own
 *  always-on display (see SocialPostView's forceFullTimestamp) and as every timestamp's hover
 *  tooltip, focused/root or not. */
function formatFullTimestamp(ts: number): string {
    return new Date(ts).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

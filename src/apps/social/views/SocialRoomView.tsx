/*
 * Social Overlay — SocialRoomView
 *
 * Twitter-like profile/group page shown when navigating to a social room.
 *
 * Features:
 * - Banner image (from the page.codeberg.everypizza.room.banner state event — MSC4221's unstable
 *   prefix, not yet the stable m.room.banner)
 * - Avatar, room name, bio, follower count
 * - Edit Profile / Edit Group form (permission-gated)
 * - Follow / Unfollow (Unfollow hidden on own profile)
 * - Compose box with file attachment (only when joined + can post)
 * - Post feed with like, reply, and thread-view navigation
 */

import React, {
    type JSX,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { MatrixEvent, type Room, KnownMembership, JoinRule, RelationType, EventType } from "matrix-js-sdk/src/matrix";
import { M_POLL_START } from "matrix-js-sdk/src/@types/polls";
import { replyCountFor, gatherRoomEvents } from "../utils/thread-relations";
import { type ICompletion } from "../../../../element-web/apps/web/src/autocomplete/Autocompleter";

import AccessibleButton from "../../../../element-web/apps/web/src/components/views/elements/AccessibleButton";
import defaultDispatcher from "../../../../element-web/apps/web/src/dispatcher/dispatcher";
import { Action } from "../../../../element-web/apps/web/src/dispatcher/actions";
import { type ViewRoomPayload } from "../../../../element-web/apps/web/src/dispatcher/payloads/ViewRoomPayload";
import { getMyReactions } from "../../../../element-web/apps/web/src/components/views/rooms/EventTile/ReactionsRowAdapter";
import { onNewScreen } from "../../../../element-web/apps/web/src/vector/routing";
import { stampSocialOrigin } from "../utils/socialHistoryOrigin";
import { RightPanelPhases } from "../../../../element-web/apps/web/src/stores/right-panel/RightPanelStorePhases";
import RoomAvatar from "../../../../element-web/apps/web/src/components/views/avatars/RoomAvatar";
import FacePile from "../../../../element-web/apps/web/src/components/views/elements/FacePile";
import { useRoomMembers, useRoomMemberCount } from "../../../../element-web/apps/web/src/hooks/useRoomMembers";
import { formatCount } from "../../../../element-web/apps/web/src/utils/FormattingUtils";
import Modal from "../../../../element-web/apps/web/src/Modal";
import QuestionDialog from "../../../../element-web/apps/web/src/components/views/dialogs/QuestionDialog";
import ImageView from "../../../../element-web/apps/web/src/components/views/elements/ImageView";
import { useMatrixClientContext } from "../../../../element-web/apps/web/src/contexts/MatrixClientContext";
import { topicToHtml } from "../../../../element-web/apps/web/src/HtmlUtils";
import { useTopic } from "../../../../element-web/apps/web/src/hooks/room/useTopic";
import { Text } from "@vector-im/compound-web";
import { LinkedText } from "@element-hq/web-shared-components";
import CopyableText from "../../../../element-web/apps/web/src/components/views/elements/CopyableText";
import { PostComposerButtons } from "../components/PostComposerButtons";
import { AttachmentShelf } from "../components/AttachmentShelf";
import { PostDialog } from "../components/PostDialog";
import { usePendingAttachment } from "../utils/postAttachment";
import { handleComposerPaste } from "../utils/pasteFile";
import { SocialEventTile } from "../components/SocialEventTile";
import { ProfileImageEditButton } from "../components/ProfileImageEditButton";
import { ExternalHandleBadge } from "../components/ExternalHandleBadge";
import { SocialScrollToTopButton } from "../components/SocialScrollToTopButton";
import { useLiveUserProfile } from "../utils/liveUserProfile";
import {
    SlashCommandAutocomplete,
    type SlashCommandAutocompleteHandle,
} from "../components/SlashCommandAutocomplete";
import { SocialPostView } from "./SocialPostView";
import {
    MSC4501_EVENT_POST,
    ROOM_BANNER_EVENT_TYPE,
    isProfileRoom,
    getVerifiedProfileUserId,
    getProfileOwnerUserId,
} from "../utils/room-classifier";
import { useLoadMoreSentinel } from "../utils/useLoadMoreSentinel";
import { useRoomMembership } from "../utils/useRoomMembership";

/** How many posts to reveal per "load more" step, mirroring FeedPane in SocialHomeView.tsx. */
const ROOM_FEED_WINDOW_SIZE = 20;

/** Past this many pixels of scroll, "scroll to top" jumps instantly instead of animating - see
 *  SocialHomeView.tsx's own identical constant/reasoning for FeedPane's scroll-to-top button. */
const SCROLL_TO_TOP_INSTANT_THRESHOLD = 4000;
import {
    followRoom,
    unfollowRoom,
    sendPost,
    sendLike,
    undoLike,
    sendComment,
    updateRoomAvatar,
    updateRoomBanner,
    removeRoomBanner,
} from "../utils/social-actions";
import { processSlashCommand } from "../utils/socialSlashCommands";
import { peekPendingFocusEvent } from "../utils/pendingFocusEvent";

interface Props {
    room: Room;
    /** Called when the user navigates back to the previous social view. */
    onBack?: () => void;
    /** Forwarded to SocialEventTile/SocialPostView — see SocialEventTile's Props doc. */
    pillsGeneration?: number;
    /** Forwarded to SocialEventTile/SocialPostView — navigates to the sender's Social profile. */
    onViewUser?: (userId: string) => void;
    /** Forwarded to SocialEventTile/SocialPostView — opens the stock member-info right panel for
     *  the sender, scoped to this room. */
    onOpenUserPanel?: (userId: string, room: Room) => void;
    /** Opens the right panel to a given phase, scoped to this room — used by the header bar. */
    onOpenRoomPanel?: (room: Room, phase: RightPanelPhases, state?: Record<string, unknown>) => void;
    /** Forwarded to SocialEventTile/SocialPostView — see SocialEventTile's Props doc. */
    onNavigateToProfile?: () => void;
    /** Forwarded to SocialEventTile/SocialPostView — see SocialEventTile's Props doc. */
    onRoomClick?: (roomId: string) => void;
    /** The ancestor `.social_Content` actually scrolls (see SocialHomeView.tsx) - used for the same
     *  "scroll to top once the composer scrolls out of view" button FeedPane has, so profile/group
     *  pages get one too, not just the aggregated Feed. */
    scrollContainerRef?: React.RefObject<HTMLElement | null>;
    /** Same purpose as FeedPane's own identical prop in SocialHomeView.tsx (see its doc there) -
     *  bumped by SocialHomeView's handleViewUser after resolving a "view this user's profile" click,
     *  since that can land back on this exact room (e.g. clicking a post's own author while already
     *  viewing their profile room) where nav.roomId never actually changes, so this component would
     *  otherwise never remount and its own `threadEvent` - invisible to nav, exactly like FeedPane's
     *  threadView - would keep showing whatever thread was open instead of returning to the plain
     *  profile feed. */
    closeThreadToken?: number;
}

// ---------------------------------------------------------------------------
// Event helpers
// ---------------------------------------------------------------------------

interface PostData {
    event: MatrixEvent;
    myLikeEventId: string | undefined;
    myRepostEventId: string | undefined;
    replyCount: number;
}

function buildPostData(events: MatrixEvent[], myUserId: string, room: Room): PostData[] {
    // `events` (from gatherRoomEvents) is already in the room's own true timeline/DAG order,
    // independent of each event's own claimed origin_server_ts - used below as a tiebreaker when
    // getTs() is equal (e.g. a bridge backfilling several posts with the same batch timestamp -
    // see the "reposted X's post" identical-timestamp bug this fixes). Precomputed once here
    // rather than events.indexOf() inside the sort comparator, which would be O(n) per call.
    const timelineIndex = new Map<string, number>();
    events.forEach((e, i) => {
        const id = e.getId();
        if (id) timelineIndex.set(id, i);
    });

    return events
        .filter((e): boolean => {
            const relates = e.getWireContent()?.["m.relates_to"];
            if (relates?.rel_type === "m.thread" || relates?.rel_type === "m.annotation") return false;
            // An edit (m.replace) is never its own post - MatrixEvent.getContent() already
            // transparently substitutes the target event's displayed body with the latest edit,
            // so showing the raw edit event too would just duplicate that same content.
            if (e.isRelation(RelationType.Replace)) return false;
            const type = e.getType();
            return type === MSC4501_EVENT_POST || type === "m.room.message" || M_POLL_START.matches(type);
        })
        .map((event) => {
            const eid = event.getId()!;
            // Read my own like/repost state via the room's own relations aggregation
            // (room.relations.getChildEventsForEvent), not by scanning `events` for annotations -
            // see SocialHomeView's aggregatePosts for why that scan is unreliable for reactions
            // specifically (the reaction pill's own count, built from this same aggregation, stays
            // correct either way - only the "is this mine" check was affected).
            const reactions = room.relations.getChildEventsForEvent(eid, RelationType.Annotation, EventType.Reaction);
            const myReactions = getMyReactions(reactions, myUserId) ?? [];
            return {
                event,
                myLikeEventId: myReactions.find((r) => r.getContent()?.["m.relates_to"]?.key === "👍")?.getId(),
                myRepostEventId: myReactions.find((r) => r.getContent()?.["m.relates_to"]?.key === "🔁")?.getId(),
                // See SocialHomeView's aggregatePosts for why this delegates to matrix-js-sdk's own
                // Thread.length for a recognized root - keeps this view's number consistent with the
                // Feed's and the opened thread view's, instead of a third independently-drifting count.
                replyCount: replyCountFor(event, room, [events]),
            };
        })
        .sort((a, b) => {
            const tsDiff = b.event.getTs() - a.event.getTs();
            if (tsDiff !== 0) return tsDiff;
            return (timelineIndex.get(b.event.getId()!) ?? 0) - (timelineIndex.get(a.event.getId()!) ?? 0);
        });
}


// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SocialRoomView({
    room,
    onBack,
    pillsGeneration,
    onViewUser,
    onOpenUserPanel,
    onOpenRoomPanel,
    onNavigateToProfile,
    onRoomClick,
    scrollContainerRef,
    closeThreadToken,
}: Props): JSX.Element {
    const client = useMatrixClientContext();
    const myUserId = client.getUserId() ?? "";
    // Live-tracked (not room.getMyMembership()'s own one-off snapshot) - this component has no other
    // state tied to membership, so nothing else was forcing a re-render after a leave/join/knock
    // succeeded, leaving the Follow/Unfollow/Leave button showing stale text until something
    // unrelated happened to re-render the page ("clicking Leave gives no feedback").
    const myMembership = useRoomMembership(client, room.roomId);
    const isJoined = myMembership === KnownMembership.Join;
    const isKnocking = myMembership === KnownMembership.Knock;
    // Was missing entirely before (fixed) - with no dedicated case, an arrived invite fell through
    // to the same isKnockable branch as "never asked yet," so the button stayed stuck on "Send
    // Follow Request" forever (clicking it would even re-knock instead of accepting) even once the
    // owner had genuinely accepted the follow/join request and a real invite existed - the auto-
    // accept effect below usually beats the user to it now, but this is still the fallback path if
    // that join itself fails and needs a manual retry.
    const isInvited = myMembership === KnownMembership.Invite;
    // Leaving a knock-only room used to fall straight to "Follow"/"Join" (a direct join, which a
    // knock-only room would just reject) instead of back to the knock-request button it started
    // as - re-checking the room's own join rule here (not just membership) is what SocialProfilePreview
    // already does for a not-yet-peeked room; mirroring it here keeps the two consistent once
    // you've left a room you can still see (peeked/previously joined).
    // getJoinRule()'s return type predates knock_restricted (same JoinRule widening
    // resolveProfileRoom already does for the same reason - see social-actions.ts).
    const joinRule = room.getJoinRule() as unknown as string;
    const isKnockable = joinRule === JoinRule.Knock || joinRule === "knock_restricted";
    // Invite-only, and this account has neither joined nor been invited - i.e. there's no path this
    // button could act on (a direct join would just 403). Reachable via a permalink/repost pointing
    // at a room with no relationship to this account at all. Shown as a disabled "Private" rather
    // than attempting (and silently failing) a join.
    const isPrivateDeadEnd = joinRule === JoinRule.Invite && !isJoined && myMembership !== KnownMembership.Invite;

    // All hooks at the top — no conditional hook calls
    const [busy, setBusy] = useState(false);
    // Briefly true right after a successful knockRoom() call, until isKnocking (membership-
    // reactive) catches up and takes over the button's label - covers "clicking Send Follow
    // Request gave no visible feedback that anything happened" for the moment between the request
    // actually succeeding and the reactive membership update landing.
    const [justSentKnock, setJustSentKnock] = useState(false);
    const [postBody, setPostBody] = useState("");
    const { attachment: pendingAttachment, setFile: setPendingFile, clear: clearAttachment } = usePendingAttachment();
    const [recorderSlot, setRecorderSlot] = useState<HTMLDivElement | null>(null);
    const [threadEvent, setThreadEvent] = useState<MatrixEvent | null>(null);
    // Same closeThreadToken pattern as FeedPane's own identical effect in SocialHomeView.tsx (see
    // its doc, and closeThreadToken's own doc on this component's Props) - skips the very first
    // render so mounting with a token that's already non-zero (this component gets a fresh mount
    // per room via its own `key={nav.roomId}` at the call site, but the token itself is a single
    // counter shared across every room) doesn't immediately close a thread this same click just
    // opened.
    const closeThreadTokenMounted = useRef(false);
    useEffect(() => {
        if (!closeThreadTokenMounted.current) {
            closeThreadTokenMounted.current = true;
            return;
        }
        setThreadEvent(null);
    }, [closeThreadToken]);

    // Keeps the browser URL bar (and back/forward history) in sync with this room's own Social
    // page and, when a thread is open, the specific post within it - see routing.ts's own
    // tryRouteSocialHashScreen for the read side (what happens when the user navigates *to* one of
    // these hashes, including via back/forward). Reassigning the same hash this room/post is
    // already showing is a no-op (browsers don't create a new history entry or fire hashchange for
    // an unchanged hash), so this is safe to run on every threadEvent change unconditionally,
    // whether it originated from a click here or from an incoming hash navigation. Covers both
    // places this component is mounted (SocialHomeView's explicit nav.roomId branch, and
    // ProfilePane's own "go straight to my profile room" branch) automatically, since both are this
    // same component.
    useEffect(() => {
        const eventId = threadEvent?.getId();
        onNewScreen(`social/room/${room.roomId}${eventId ? `/${eventId}` : ""}`);
        // Marks this history entry as "this room's own dedicated page" - see
        // socialHistoryOrigin.ts's own doc for why a thread viewed here needs to be distinguished
        // from the same post viewed via FeedPane's own thread panel (identical hash otherwise).
        stampSocialOrigin("room");
    }, [room.roomId, threadEvent]);

    // Slash command autocomplete (see SlashCommandAutocomplete.tsx) - selection tracks the
    // textarea's own cursor position, kept in sync via onChange/onSelect/onClick/onKeyUp since a
    // plain textarea has no dedicated "selection changed" event of its own. pendingCursorPos
    // carries a cursor position through to the effect below once postBody's own state update (and
    // the textarea's re-render with it) has actually landed - setting selectionStart/End
    // immediately after setPostBody wouldn't yet see the new value in the DOM.
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const autocompleteControlRef = useRef<SlashCommandAutocompleteHandle | null>(null);
    const [selection, setSelection] = useState({ start: 0, end: 0 });
    const pendingCursorPos = useRef<number | null>(null);
    useEffect(() => {
        if (pendingCursorPos.current !== null && textareaRef.current) {
            textareaRef.current.selectionStart = pendingCursorPos.current;
            textareaRef.current.selectionEnd = pendingCursorPos.current;
            pendingCursorPos.current = null;
        }
    }, [postBody]);
    const updateSelectionFrom = useCallback((el: HTMLTextAreaElement) => {
        setSelection({ start: el.selectionStart, end: el.selectionEnd });
    }, []);
    const handleConfirmCompletion = useCallback(
        (completion: ICompletion) => {
            const { start, end } = completion.range;
            pendingCursorPos.current = start + completion.completion.length;
            setPostBody((body) => body.slice(0, start) + completion.completion + body.slice(end));
        },
        [],
    );

    const [allEvents, setAllEvents] = useState<MatrixEvent[]>(() => gatherRoomEvents(room));

    // Edit Profile/Edit Group opens the exact same Room Settings dialog stock Element uses,
    // scoped to this room explicitly (open_room_settings falls back to whatever room the
    // RoomViewStore thinks is "current" if no room_id is given, which Social never sets).
    const openRoomSettings = useCallback(() => {
        defaultDispatcher.dispatch({ action: "open_room_settings", room_id: room.roomId });
    }, [room.roomId]);

    useEffect(() => {
        setThreadEvent(null);
    }, [room.roomId]);

    // Hand-off from SocialHomeView's own pendingViewPost consumption (see permalinkRouting.ts) - a
    // matrix.to/matrix: link to a specific post in this room, clicked from outside Social entirely,
    // resolved to this room and navigated here via viewRoom before this component existed to
    // receive the event directly. Only actually focuses a thread if the event turns out to belong
    // to this exact room - consumePendingFocusEvent can't distinguish "wrong room" itself since
    // it's a single global value, not scoped per-room.
    //
    // Carries the real, already-resolved MatrixEvent - not just its id (fixed; used to be just an
    // id, re-resolved here via room.findEventById with a fetchRoomEvent fallback of its own). That
    // redundant second resolution attempt is exactly what caused "auto-accepted the follow
    // request, but never opened the post": resolveAndOpenPost (SocialEventTile.tsx) already fully
    // resolves this event before ever calling back here - including its own fetchRoomEvent
    // fallback for a room whose just-joined initial sync doesn't reach back far enough - only to
    // have that resolved event thrown away and re-derived from scratch, hitting the exact same
    // "not in the synced timeline yet" wall a second time. Using the already-resolved event
    // directly removes that redundant, independently-fallible second attempt entirely.
    useEffect(() => {
        const event = peekPendingFocusEvent();
        if (!event || event.getRoomId() !== room.roomId) return;
        setThreadEvent(event);
    }, [room]);

    // Auto-accept an invite that arrives while viewing this knock-access page directly with no
    // specific post in mind (e.g. clicked through to this profile/group from a user's name/avatar,
    // landing on its own inline Send Follow Request button - a matrix.to link to a specific post
    // goes through KnockToFollowDialog in SocialEventTile.tsx instead, which already resolves and
    // auto-accepts on its own before ever navigating here, so there's never a pending focus event
    // still waiting on an invite by the time this effect could matter). autoAcceptedRef guards
    // against double-joining if this effect re-fires for an unrelated reason while still invited.
    const autoAcceptedRef = useRef(false);
    useEffect(() => {
        if (myMembership !== KnownMembership.Invite || autoAcceptedRef.current) return;
        autoAcceptedRef.current = true;
        void (async () => {
            try {
                await client.joinRoom(room.roomId);
            } catch {
                autoAcceptedRef.current = false; // let a retry (e.g. a fresh invite event) try again
            }
        })();
    }, [client, room, myMembership]);

    // A background timeline refresh (someone else liking/reposting/replying, or this room's own
    // history backfilling in) rebuilds `allEvents`/`posts` from scratch - matrix-js-sdk's own
    // timeline windowing during a backfill-in-progress can genuinely show fewer events for one
    // intermediate render before growing back to the full set. If that transient shrink drops the
    // scrollable height below the current scroll position, the browser clamps scrollTop down to
    // fit - usually all the way to 0 - discarding the user's actual scroll position. That's what
    // showed up as "the scroll-to-top button shows briefly then disappears": the button correctly
    // hid because the browser had already silently scrolled them to the top out from under them.
    // Snapshot/restore scrollTop around every refresh so a transient shrink never loses it -
    // useLayoutEffect (not useEffect) so the restore applies before the browser paints the
    // shrunk-then-regrown content, avoiding a visible flash back to the top first.
    const preRefreshScrollTop = useRef<number | null>(null);
    useLayoutEffect(() => {
        if (preRefreshScrollTop.current !== null && scrollContainerRef?.current) {
            scrollContainerRef.current.scrollTop = preRefreshScrollTop.current;
            preRefreshScrollTop.current = null;
        }
    }, [allEvents, scrollContainerRef]);

    useEffect(() => {
        const refresh = (): void => {
            preRefreshScrollTop.current = scrollContainerRef?.current?.scrollTop ?? null;
            setAllEvents(gatherRoomEvents(room));
        };
        room.on("Room.timeline" as any, refresh);
        room.on("Room.localEchoUpdated" as any, refresh);
        return () => {
            room.off("Room.timeline" as any, refresh);
            room.off("Room.localEchoUpdated" as any, refresh);
        };
    }, [room, scrollContainerRef]);

    const posts = useMemo(() => buildPostData(allEvents, myUserId, room), [allEvents, myUserId, room]);

    // Windowed rendering — same rationale as FeedPane in SocialHomeView.tsx: mount only the first
    // `visibleCount` posts and grow it as the user scrolls near the bottom, rather than mounting
    // every post already loaded into this room's timeline at once.
    const [visibleCount, setVisibleCount] = useState(ROOM_FEED_WINDOW_SIZE);
    const visiblePosts = posts.slice(0, visibleCount);

    // Once the visible window catches up to every post already loaded locally (whatever came in
    // via the initial /sync), growing visibleCount alone has nothing further to reveal - scrolling
    // just silently stopped loading anything more, even when the room has plenty more history the
    // server hasn't sent yet. paginateEventTimeline backfills more of it; canPaginateMore (its own
    // return value - false once the start of the room's history is reached) is what actually gates
    // whether there's more to fetch, not just what's currently visible.
    const [paginating, setPaginating] = useState(false);
    const [canPaginateMore, setCanPaginateMore] = useState(true);
    const handleLoadMore = useCallback(() => {
        if (visibleCount < posts.length) {
            setVisibleCount((n) => n + ROOM_FEED_WINDOW_SIZE);
            return;
        }
        if (paginating || !canPaginateMore) return;
        setPaginating(true);
        client
            .paginateEventTimeline(room.getLiveTimeline(), { backwards: true, limit: ROOM_FEED_WINDOW_SIZE })
            .then((gotMore) => {
                setCanPaginateMore(gotMore);
                // The newly-backfilled events land in allEvents via the existing Room.timeline
                // listener above - grow the window too so they actually become visible instead of
                // just sitting loaded-but-hidden behind the current visibleCount.
                if (gotMore) setVisibleCount((n) => n + ROOM_FEED_WINDOW_SIZE);
            })
            .finally(() => setPaginating(false));
    }, [client, room, visibleCount, posts.length, paginating, canPaginateMore]);
    const hasMoreToShow = visibleCount < posts.length || canPaginateMore;
    const sentinelRef = useLoadMoreSentinel(handleLoadMore, hasMoreToShow && !paginating);

    // Derived room state. useTopic (plus the bridged-HTML fallback baked into its own getTopic -
    // see bridgedTopicHtml.ts) is the same source stock's own RightPanel topic reads from, so a
    // bio bridged in from the Fediverse with real HTML in it renders identically in both places,
    // through the same reduced/safe tag set (topicToHtml's default allowExtendedHtml=false).
    const topicState = useTopic(room);
    // Whether this room should look/behave like a Group page: true for an actual MSC4501 Group
    // room, but also for any plain (non-Social) room reached via a dev-only shortcut (see
    // EventTile.tsx/SocialEventTile.tsx's own Shift+Click-to-Social conventions) - a room that
    // isn't a real Social room at all has no "person" to follow, so it should read the same as a
    // Group (membership language, room alias, etc.) rather than defaulting to profile/person
    // wording just because isGroupRoom(room) alone happens to be false for it too.
    const groupLike = !isProfileRoom(room);
    // Shown under the name: the linked MXID for a profile room (only once it's a validly-formed
    // MSC4501 profile_user_id state event - see getVerifiedProfileUserId), or the primary alias
    // for a group-like room, whichever applies. Neither shows anything when absent.
    const profileUserId = isProfileRoom(room) ? getVerifiedProfileUserId(room) : undefined;
    const groupAlias = groupLike ? room.getCanonicalAlias() : null;
    // haven apps-framework patch: MSC4503 external handle for a profile room's own user - see
    // ExternalHandleBadge.tsx. Never set for a group room (profileUserId is undefined there).
    const profileLiveUserProfile = useLiveUserProfile(client, profileUserId);
    // Live-updating (not a one-off snapshot) — same hooks stock RoomHeader uses for its own
    // member face pile, so this behaves identically as people join/leave while it's on screen.
    const members = useRoomMembers(room, 2500);
    const memberCount = useRoomMemberCount(room, { throttleWait: 2500, includeInvited: true });

    // Banner image
    const bannerEvent = room.currentState.getStateEvents(ROOM_BANNER_EVENT_TYPE, "");
    const bannerMxc: string | undefined = bannerEvent?.getContent()?.url;
    const bannerHttpUrl = bannerMxc ? client.mxcUrlToHttp(bannerMxc) : null;

    // Own-profile / permission checks. Uses the room's true owner (MSC4501_PROFILE_USER_ID_KEY,
    // falling back to m.room.create's creator) rather than the creator alone, since a profile room
    // provisioned by a bridge/appservice on the owner's behalf has a creator that isn't the actual
    // owner - see getProfileOwnerUserId's own doc.
    const profileOwnerUserId = getProfileOwnerUserId(room);
    const isOwnProfile = !!profileOwnerUserId && profileOwnerUserId === myUserId;
    const canEdit = room.currentState.maySendStateEvent("m.room.name", myUserId);

    // Whether to hide room name in post tiles (own-profile posts)
    const getHideRoomName = useCallback(
        (event: MatrixEvent): boolean => {
            if (!profileOwnerUserId) return false;
            return event.getSender() === profileOwnerUserId;
        },
        [profileOwnerUserId],
    );

    const handleFollowToggle = useCallback(async () => {
        // An invite-only or knock-access room becomes permanently unjoinable once its last member
        // leaves (no public join, and no one left to invite/approve a knock) - the same irreversible
        // situation stock Element's own Leave Room dialog (MatrixChat's leaveRoomWarnings/leaveRoom)
        // warns about before an ordinary room leave. A public room is freely rejoinable any time, so
        // this only gates the actually-risky case - cancelling a still-pending knock isn't a real
        // leave either (nothing irreversible about re-requesting), so it's excluded too.
        if (isJoined && (joinRule === JoinRule.Invite || isKnockable)) {
            const groupRoom = groupLike;
            const onlyMember = room.getJoinedMemberCount() === 1;
            const { finished } = Modal.createDialog(QuestionDialog, {
                title: groupRoom ? "Leave Group" : "Unfollow Profile",
                description: (
                    <span>
                        {`Are you sure you want to ${groupRoom ? "leave this group" : "unfollow"} '${room.name}'?`}
                        {onlyMember && (
                            <strong className="warning">
                                {" "}
                                You are the only person here. If you leave, no one will be able to join in the
                                future, including you.
                            </strong>
                        )}
                    </span>
                ),
                button: groupRoom ? "Leave" : "Unfollow",
                danger: onlyMember,
            });
            const [shouldLeave] = await finished;
            if (!shouldLeave) return;
        }

        setBusy(true);
        try {
            if (isInvited) {
                // Accepting an already-arrived invite manually - the auto-accept effect above beats
                // this to it in the common case, but a failed auto-accept (e.g. a transient network
                // error) falls back to this same button for a manual retry rather than being stuck.
                await client.joinRoom(room.roomId);
            } else if (isJoined || isKnocking) {
                // Leave also cancels a pending knock - same single leave endpoint either way.
                await unfollowRoom(client, room.roomId);
                setJustSentKnock(false);
            } else if (isKnockable) {
                await client.knockRoom(room.roomId);
                // isKnocking (membership-reactive, via useRoomMembership) normally catches up within
                // the same tick, but this covers the brief gap - see the label below.
                setJustSentKnock(true);
            } else {
                await followRoom(client, room.roomId);
            }
        } finally {
            setBusy(false);
        }
    }, [client, isJoined, isKnocking, isKnockable, isInvited, joinRule, room]);

    const handlePost = useCallback(
        async (e?: React.SyntheticEvent) => {
            e?.preventDefault();
            const body = postBody.trim();
            if (!body && !pendingAttachment) return;
            setBusy(true);
            try {
                // A slash command is a text-only utility (e.g. ;follow) - doesn't make sense
                // combined with a media post, so an attachment always skips it and sends as a
                // plain (possibly caption-less) media post instead.
                if (pendingAttachment) {
                    await sendPost(client, room.roomId, body, undefined, pendingAttachment.file);
                    setPostBody("");
                    clearAttachment();
                    return;
                }
                const result = await processSlashCommand(client, room.roomId, body);
                if (!result.handled) {
                    await sendPost(client, room.roomId, result.body, result.formattedBody, undefined, result.isEmote);
                    setPostBody("");
                } else if (result.success) {
                    setPostBody("");
                }
                // errored/declined - leave the typed text in place to fix or reconsider.
            } finally {
                setBusy(false);
            }
        },
        [client, room.roomId, postBody, pendingAttachment, clearAttachment],
    );

    const handleLike = useCallback(
        async (eventId: string, myLikeEventId: string | undefined): Promise<void> => {
            if (myLikeEventId) {
                await undoLike(client, room.roomId, myLikeEventId);
            } else {
                await sendLike(client, room.roomId, eventId);
            }
        },
        [client, room.roomId],
    );

    const handleReply = useCallback(
        async (eventId: string, body: string, file?: File): Promise<void> => {
            // Same media-skips-slash-commands reasoning as handlePost above.
            if (file) {
                await sendComment(client, room.roomId, body, eventId, file);
                return;
            }
            const result = await processSlashCommand(client, room.roomId, body);
            if (!result.handled) {
                await sendComment(client, room.roomId, result.body, eventId, undefined, result.formattedBody, result.isEmote);
            }
            // handled (ran as a command, or declined/errored) - nothing left to send as a reply.
        },
        [client, room.roomId],
    );

    // Own-profile avatar/banner editing (see ProfileImageEditButton) — takes effect immediately on
    // selection, no separate save step, matching the rest of this page's direct-action feel.
    const handleAvatarUpload = useCallback(
        async (file: File): Promise<void> => {
            await updateRoomAvatar(client, room.roomId, file);
        },
        [client, room.roomId],
    );
    const handleBannerUpload = useCallback(
        async (file: File): Promise<void> => {
            await updateRoomBanner(client, room.roomId, file);
        },
        [client, room.roomId],
    );
    const handleBannerRemove = useCallback(async (): Promise<void> => {
        await removeRoomBanner(client, room.roomId);
    }, [client, room.roomId]);

    // Can the user compose posts? Profile rooms restrict posting to the owner.
    const canPost = isJoined && (isOwnProfile || !isProfileRoom(room));

    // "Scroll to top" button (SocialScrollToTopButton.tsx) - same pattern as FeedPane's own in
    // SocialHomeView.tsx: shown once the composer scrolls out of view of the actual scrolling
    // ancestor (.social_Content, passed down as scrollContainerRef - this component itself doesn't
    // scroll). threadEvent is in this effect's own deps for the same reason as FeedPane's
    // threadView: the compose <form ref={composerRef}> unmounts while a thread is open (the
    // threadEvent early return below replaces this component's whole JSX) and a fresh one mounts on
    // return, so without threadEvent here the observer would stay attached to the old, now-detached
    // element forever after the first thread visit.
    //
    // Deliberately declared *before* the threadEvent early return below (fixed - these, and every
    // hook between here and that return, used to be declared *after* it). Hooks must run
    // unconditionally in the same order on every render; a hook declared after an early return
    // gets silently skipped the moment that return actually triggers, which is exactly what
    // "Rendered fewer hooks than expected" further down means - React catching this the instant
    // threadEvent first became truthy on a real render (which used to essentially never happen,
    // for unrelated reasons now fixed elsewhere, so this was never actually exercised until now).
    const composerRef = useRef<HTMLFormElement>(null);
    const [composerVisible, setComposerVisible] = useState(true);
    useEffect(() => {
        if (!canPost || !composerRef.current || !scrollContainerRef?.current) return;
        const observer = new IntersectionObserver(
            ([entry]) => setComposerVisible(entry.isIntersecting),
            { root: scrollContainerRef.current },
        );
        observer.observe(composerRef.current);
        return () => observer.disconnect();
    }, [canPost, scrollContainerRef, threadEvent]);
    const scrollToTop = useCallback(() => {
        const el = scrollContainerRef?.current;
        if (!el) return;
        // A smooth scroll over a very long distance takes a noticeably long time to finish -
        // jump straight there instead once there's more than a couple of screens' worth to cover.
        const behavior = el.scrollTop > SCROLL_TO_TOP_INSTANT_THRESHOLD ? "auto" : "smooth";
        el.scrollTo({ top: 0, behavior });
    }, [scrollContainerRef]);

    // Same fallback as FeedPane's own identical pair in SocialHomeView.tsx (see its doc) - a file
    // picked/pasted/dropped while this composer is scrolled out of view pops up the sidebar's own
    // Post modal, staged with the file and targeting this room directly (no "Post to:" picker here
    // to preserve - this composer only ever posts into `room`).
    const openScrolledAwayPostModal = useCallback(
        (file: File) => {
            Modal.createDialog(PostDialog, { client, initialRoomId: room.roomId, initialFile: file }, "social_PostDialog_wrapper");
        },
        [client, room],
    );
    const handleRoomFileSelected = useCallback(
        (file: File) => {
            if (composerVisible) {
                setPendingFile(file);
            } else {
                openScrolledAwayPostModal(file);
            }
        },
        [composerVisible, setPendingFile, openScrolledAwayPostModal],
    );

    // Thread view: show SocialPostView when threadEvent is set
    if (threadEvent) {
        return (
            <SocialPostView
                event={threadEvent}
                room={room}
                onBack={() => setThreadEvent(null)}
                onFocusEvent={setThreadEvent}
                pillsGeneration={pillsGeneration}
                onViewUser={onViewUser}
                onOpenUserPanel={onOpenUserPanel}
                onNavigateToProfile={onNavigateToProfile}
                onRoomClick={onRoomClick}
            />
        );
    }

    return (
        <div className="social_RoomView">
            {canPost && !composerVisible && <SocialScrollToTopButton onClick={scrollToTop} />}
            {onBack && (
                <div className="social_RoomView_backBar">
                    <button className="social_BackBtn" onClick={onBack}>
                        ← Back
                    </button>
                </div>
            )}

            {/* Banner */}
            <div className="social_RoomView_bannerWrap">
                {bannerHttpUrl ? (
                    <AccessibleButton
                        element="img"
                        src={bannerHttpUrl}
                        className="social_RoomView_banner social_RoomView_banner--clickable"
                        alt={`${room.name} banner`}
                        onClick={() =>
                            Modal.createDialog(
                                ImageView,
                                { src: bannerHttpUrl, name: room.name },
                                "mx_Dialog_lightbox",
                                undefined,
                                true,
                            )
                        }
                    />
                ) : (
                    <div className="social_RoomView_banner" aria-hidden />
                )}
                {isOwnProfile && (
                    <ProfileImageEditButton
                        label="Edit banner"
                        className="social_RoomView_bannerEditButton"
                        onUpload={(file) => void handleBannerUpload(file)}
                        onRemove={bannerHttpUrl ? () => void handleBannerRemove() : undefined}
                    />
                )}
            </div>

            {/* Header: avatar, name, bio, follow/edit buttons */}
            <div className="social_RoomView_header">
                    {/* Pinned to the header's own top-right corner (position:absolute) rather than
                        flowing alongside the name/bio - previously stacked in the same right-hand
                        column as .social_RoomView_info, which a long unbroken bio string could push
                        off the page entirely along with it. Order left-to-right: Edit (if
                        canEdit) - Join/Follow/Unfollow/etc (if not own profile) - the follower/
                        member pile, all in one aligned row. */}
                    <div className="social_RoomView_topActions">
                        {canEdit && (
                            <AccessibleButton
                                // "secondary" is a plain text/underline link, not a real button
                                // shape - see the Follow/Unfollow button below for the same fix.
                                // primary_outline is a bordered (not filled) button, appropriately
                                // less prominent than Follow/Unfollow's solid fill for a lower-
                                // stakes management action.
                                kind="primary_outline"
                                element="button"
                                onClick={openRoomSettings}
                            >
                                {isProfileRoom(room) ? "Edit Profile" : "Edit Group"}
                            </AccessibleButton>
                        )}
                        {/* Hide Follow/Unfollow on own profile */}
                        {!isOwnProfile && (
                            <AccessibleButton
                                // "secondary" is actually a plain text/underline link style, not
                                // a solid button with different coloring - "danger" shares
                                // "primary"'s exact solid shape (border + filled background),
                                // just swapping the accent color for the critical/red one, which
                                // is what "same style, different coloring" actually means here.
                                // Leaving and cancelling a pending knock are both "danger" (both
                                // undo the current relationship), everything else is "primary".
                                kind={isPrivateDeadEnd ? "primary_outline" : isJoined || isKnocking ? "danger" : "primary"}
                                element="button"
                                disabled={busy || isPrivateDeadEnd}
                                onClick={handleFollowToggle}
                            >
                                {/* Groups use membership language (Join/Leave/Request to
                                    Join) instead of the person-following language
                                    (Follow/Unfollow/Send Follow Request) used for profile
                                    rooms - same actions, same buttons, just worded for what
                                    you're actually doing. isKnockable (not just "not
                                    joined") is what makes leaving a knock-only room go back
                                    to a request button instead of a direct join/follow one,
                                    which would just be rejected by a knock-only room.
                                    isPrivateDeadEnd overrides everything else - an invite-only
                                    room this account has no relationship to at all has no
                                    action this button could actually perform. isInvited (a
                                    knock the owner has already accepted) used to have no case
                                    here at all, silently falling through to the isKnockable
                                    branch - the button stayed stuck on "Send Follow Request"
                                    forever, and clicking it would even re-knock instead of
                                    accepting, instead of the auto-accept effect above (or this
                                    button, as its manual fallback) actually joining. busy shows
                                    "Sending…" for any in-flight action; justSentKnock covers the
                                    brief remaining gap between knockRoom() resolving and
                                    isKnocking (membership-reactive) catching up to take over. */}
                                {isPrivateDeadEnd
                                    ? "Private"
                                    : busy
                                      ? "Sending…"
                                      : isInvited
                                        ? groupLike
                                            ? "Accept Invite"
                                            : "Accept Follow Request"
                                        : groupLike
                                          ? isJoined
                                              ? "Leave"
                                              : isKnocking
                                                ? "Cancel Join Request"
                                                : justSentKnock
                                                  ? "Join Request Sent"
                                                  : isKnockable
                                                    ? "Request to Join"
                                                    : "Join"
                                          : isJoined
                                            ? "Unfollow"
                                            : isKnocking
                                              ? "Cancel Follow Request"
                                              : justSentKnock
                                                ? "Follow Request Sent"
                                                : isKnockable
                                                  ? "Send Follow Request"
                                                  : "Follow"}
                            </AccessibleButton>
                        )}
                        <div className="social_RoomView_memberPile">
                            <span className="social_RoomView_memberPileLabel">
                                {isProfileRoom(room) ? "Followers:" : "Members:"}
                            </span>
                            {/* Same face-pile-plus-count pill stock RoomHeader shows top-right
                                for a regular room — see RoomHeader.tsx. */}
                            <FacePile
                                members={members.slice(0, 3)}
                                size="20px"
                                overflow={false}
                                viewUserOnClick={false}
                                tooltipLabel={`${memberCount} ${isProfileRoom(room) ? "followers" : "members"}`}
                                onClick={() => onOpenRoomPanel?.(room, RightPanelPhases.MemberList)}
                            >
                                {formatCount(memberCount)}
                            </FacePile>
                        </div>
                    </div>
                    <div className="social_RoomView_avatarWrap">
                        <RoomAvatar room={room} size="104px" viewAvatarOnClick />
                        {isOwnProfile && (
                            <ProfileImageEditButton
                                label="Edit avatar"
                                className="social_RoomView_avatarEditButton"
                                onUpload={(file) => void handleAvatarUpload(file)}
                            />
                        )}
                    </div>
                    <div className="social_RoomView_meta">
                        <div className="social_RoomView_info">
                            {/* Opens the stock room-info RightPanel (RoomSummary), same as
                                clicking the room name in normal Element's own room header -
                                Shift+Click instead opens this room in the regular chat view, same
                                house convention as SocialEventTile's own Shift+Click-on-timestamp
                                (see permalinkRouting.ts's own doc comment on this). */}
                            <button
                                className="social_RoomView_nameBtn"
                                onClick={(e) => {
                                    if (e.shiftKey) {
                                        defaultDispatcher.dispatch<ViewRoomPayload>({
                                            action: Action.ViewRoom,
                                            room_id: room.roomId,
                                            metricsTrigger: undefined,
                                        });
                                        return;
                                    }
                                    onOpenRoomPanel?.(room, RightPanelPhases.RoomSummary);
                                }}
                            >
                                <h2>{room.name}</h2>
                            </button>
                            {(profileUserId || groupAlias) && (
                                <Text size="sm" weight="semibold" className="social_RoomView_identifier">
                                    <CopyableText getTextToCopy={() => profileUserId || groupAlias} border={false}>
                                        {profileUserId || groupAlias}
                                    </CopyableText>
                                </Text>
                            )}
                            {/* haven apps-framework patch: only renders once a validly-shaped
                                MSC4503 external_handle resolves for this profile room's user - see
                                ExternalHandleBadge.tsx. Never set for a group room. */}
                            {profileLiveUserProfile?.externalHandle && (
                                <ExternalHandleBadge externalHandle={profileLiveUserProfile.externalHandle} />
                            )}
                            {(topicState?.text || topicState?.html) && (
                                <p className="social_RoomView_topic">
                                    {/* topicToHtml alone only sanitizes/renders an already-HTML bio -
                                        a plain-text bio's bare URLs stay inert text otherwise, same
                                        as stock RoomTopic.tsx/RoomSummaryCardView.tsx, which both
                                        wrap the same way for exactly this reason. */}
                                    <LinkedText>{topicToHtml(topicState.text, topicState.html)}</LinkedText>
                                </p>
                            )}
                        </div>
                    </div>
            </div>

            {/* Compose box — only when user can post */}
            {canPost && (
                <form className="social_ComposeBox" onSubmit={handlePost} ref={composerRef}>
                    <div className="social_ComposeBox_inputWrap">
                        <SlashCommandAutocomplete
                            room={room}
                            query={postBody}
                            selectionStart={selection.start}
                            selectionEnd={selection.end}
                            onConfirm={handleConfirmCompletion}
                            onCompletionsChange={() => {}}
                            controlRef={autocompleteControlRef}
                        />
                        <textarea
                            ref={textareaRef}
                            className="social_ComposeBox_input"
                            placeholder="Write a post…"
                            value={postBody}
                            onChange={(e) => {
                                setPostBody(e.target.value);
                                updateSelectionFrom(e.target);
                            }}
                            onSelect={(e) => updateSelectionFrom(e.currentTarget)}
                            onClick={(e) => updateSelectionFrom(e.currentTarget)}
                            onKeyUp={(e) => updateSelectionFrom(e.currentTarget)}
                            onPaste={handleComposerPaste}
                            onKeyDown={(e) => {
                                if (autocompleteControlRef.current?.hasCompletions()) {
                                    if (e.key === "ArrowUp") {
                                        e.preventDefault();
                                        autocompleteControlRef.current.moveSelection(-1);
                                        return;
                                    }
                                    if (e.key === "ArrowDown") {
                                        e.preventDefault();
                                        autocompleteControlRef.current.moveSelection(1);
                                        return;
                                    }
                                    if (e.key === "Enter" || e.key === "Tab") {
                                        if (autocompleteControlRef.current.confirmSelection()) {
                                            e.preventDefault();
                                            return;
                                        }
                                    }
                                    if (e.key === "Escape") {
                                        e.preventDefault();
                                        autocompleteControlRef.current.close();
                                        return;
                                    }
                                }
                                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                                    e.preventDefault();
                                    void handlePost();
                                }
                            }}
                            disabled={busy}
                            rows={3}
                        />
                    </div>
                    {pendingAttachment && (
                        <AttachmentShelf attachment={pendingAttachment} uploading={busy} onRemove={clearAttachment} />
                    )}
                    <div className="social_ComposeBox_recorderSlot" ref={setRecorderSlot} />
                    <div className="social_ComposeBox_footer">
                        {!busy && (
                            <PostComposerButtons
                                room={room}
                                addEmoji={(emoji) => {
                                    setPostBody((body) => body + emoji);
                                    return true;
                                }}
                                canSubmit={!!postBody.trim() || !!pendingAttachment}
                                onSubmit={() => void handlePost()}
                                sendButtonTitle="Post"
                                recorderSlot={recorderSlot}
                                onFileSelected={handleRoomFileSelected}
                            />
                        )}
                    </div>
                </form>
            )}

            {/* Post feed */}
            <div className="social_RoomView_feed">
                {posts.length === 0 ? (
                    <p className="social_ContentEmpty">No posts yet.</p>
                ) : (
                    <>
                        {visiblePosts.map(({ event, myLikeEventId, myRepostEventId, replyCount }) => (
                            <SocialEventTile
                                key={event.getId()}
                                event={event}
                                room={room}
                                isLiked={!!myLikeEventId}
                                isReposted={!!myRepostEventId}
                                replyCount={replyCount}
                                hideRoomName={getHideRoomName(event)}
                                pillsGeneration={pillsGeneration}
                                onViewUser={onViewUser}
                                onOpenUserPanel={onOpenUserPanel}
                                onNavigateToProfile={onNavigateToProfile}
                                onRoomClick={onRoomClick}
                                onViewThread={(e) => setThreadEvent(e)}
                                onLike={() => handleLike(event.getId()!, myLikeEventId)}
                                onReply={(body, file) => handleReply(event.getId()!, body, file)}
                            />
                        ))}
                        {/* Purely reveals more of what's already loaded in this room's timeline —
                            no network fetch, so no spinner (should be instant). */}
                        {hasMoreToShow && <div ref={sentinelRef} className="social_Feed_loadMore" />}
                    </>
                )}
            </div>

        </div>
    );
}

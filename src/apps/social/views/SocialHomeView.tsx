/*
 * Social Overlay — SocialHomeView
 *
 * Top-level social experience. Replaces both the room list and the room view
 * when the Social Feed button is active in the spaces panel.
 *
 * Layout: left nav sidebar (Feed / Groups / Profile) + main content area.
 * Navigating to a specific group or profile room shows SocialRoomView inline.
 */

import React, {
    type JSX,
    useCallback,
    useContext,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    type MatrixEvent,
    type Room,
    type MatrixClient,
    KnownMembership,
    M_POLL_START,
    RelationType,
    EventType,
} from "matrix-js-sdk/src/matrix";
import { type ICompletion } from "../../../../element-web/apps/web/src/autocomplete/Autocompleter";
import {
    PublicIcon,
    GroupIcon,
    UserProfileSolidIcon,
    FilterIcon,
    ArrowLeftIcon,
    ComposeIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";
import { Resizable } from "re-resizable";
import { useSetUserMenuPortalTarget } from "../../framework/UserMenuPortalContext";

import { useMatrixClientContext } from "../../../../element-web/apps/web/src/contexts/MatrixClientContext";
import { SDKContext } from "../../../../element-web/apps/web/src/contexts/SDKContext";
import RoomAvatar from "../../../../element-web/apps/web/src/components/views/avatars/RoomAvatar";
import Spinner from "../../../../element-web/apps/web/src/components/views/elements/Spinner";
import RightPanel from "../../../../element-web/apps/web/src/components/structures/RightPanel";
import NotificationPanel from "../../../../element-web/apps/web/src/components/structures/NotificationPanel";
import MainSplit from "../../../../element-web/apps/web/src/components/structures/MainSplit";
import Modal from "../../../../element-web/apps/web/src/Modal";
import { RightPanelPhases } from "../../../../element-web/apps/web/src/stores/right-panel/RightPanelStorePhases";
import defaultDispatcher from "../../../../element-web/apps/web/src/dispatcher/dispatcher";
import { Action } from "../../../../element-web/apps/web/src/dispatcher/actions";
import { onNewScreen } from "../../../../element-web/apps/web/src/vector/routing";
import { stampSocialOrigin } from "../utils/socialHistoryOrigin";
import { replyCountFor, gatherRoomEvents } from "../utils/thread-relations";
import { consumePendingFeedThread } from "../utils/pendingFeedThread";
import { useDispatcher } from "../../../../element-web/apps/web/src/hooks/useDispatcher";
import { useSettingValue } from "../../../../element-web/apps/web/src/hooks/useSettings";
import { UPDATE_EVENT } from "../../../../element-web/apps/web/src/stores/AsyncStore";
import { getMyReactions } from "../../../../element-web/apps/web/src/components/views/rooms/EventTile/ReactionsRowAdapter";
import { RoomPermalinkCreator } from "../../../../element-web/apps/web/src/utils/permalinks/Permalinks";
import { NotificationsButton } from "../components/NotificationsButton";
import { PostComposerButtons } from "../components/PostComposerButtons";
import { AttachmentShelf } from "../components/AttachmentShelf";
import { usePendingAttachment } from "../utils/postAttachment";
import { handleComposerPaste } from "../utils/pasteFile";
import { RoomPickerButton } from "../components/RoomPickerButton";
import { SocialEventTile, resolveAndOpenPost, showPrivateProfileModal } from "../components/SocialEventTile";
import { SocialScrollToTopButton } from "../components/SocialScrollToTopButton";
import {
    SlashCommandAutocomplete,
    type SlashCommandAutocompleteHandle,
} from "../components/SlashCommandAutocomplete";
import { FeedFilterDialog } from "../components/FeedFilterDialog";
import { useWindowFileDrop } from "../utils/useWindowFileDrop";
import { SocialPostView } from "./SocialPostView";
import { PostDialog } from "../components/PostDialog";
import { consumePendingViewUserId, peekPendingViewUserId } from "../utils/pendingViewUser";
import { consumePendingViewPost } from "../utils/pendingViewPost";
import { clearPendingFocusEvent, setPendingFocusEvent } from "../utils/pendingFocusEvent";
import { peekPendingSocialSection, clearPendingSocialSection } from "../utils/pendingSocialSection";
import { consumePendingPostModal } from "../utils/pendingPostModal";
import {
    isGroupRoom,
    isProfileRoom,
    getProfileOwnerUserId,
    MSC4501_EVENT_POST,
    ROOM_BANNER_EVENT_TYPE,
} from "../utils/room-classifier";
import {
    type SocialFeedFilter,
    loadSocialFeedFilter,
    roomCountsForFeed,
    senderExcludedFromFeed,
} from "../utils/socialFeedFilter";
import { useBackfillSocialRooms } from "../utils/useBackfillSocialRooms";
import { useLoadMoreSentinel } from "../utils/useLoadMoreSentinel";
import { useProfileRoomLink } from "../utils/useProfileRoomLink";
import {
    sendLike,
    undoLike,
    sendComment,
    sendPost,
    getProfileRoomLink,
    resolveProfileRoom,
} from "../utils/social-actions";
import { processSlashCommand } from "../utils/socialSlashCommands";
import { openCreateGroupDialog, openCreateProfileDialog } from "../utils/createSocialRoom";
import { SocialRoomView } from "./SocialRoomView";
import { SocialUserProfileView } from "./SocialUserProfileView";
import { SocialProfilePreview } from "./SocialProfilePreview";

import { SOCIAL_HOME_ACTION } from "../homeAction";
export { SOCIAL_HOME_ACTION } from "../homeAction";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** How many posts to reveal per "load more" step (from memory, or by fetching more history). */
const FEED_WINDOW_SIZE = 20;

/** Past this many pixels of scroll, "scroll to top" jumps instantly instead of animating - a
 *  smooth scroll over a very long feed takes a noticeably long time to finish, which reads as
 *  sluggish rather than helpful. Shared value with SocialRoomView.tsx's own identical button. */
const SCROLL_TO_TOP_INSTANT_THRESHOLD = 4000;

// Sidebar (Feed/Groups/Profile nav) resize bounds — max matches the fixed width it used to have;
// min is just enough for a centered 24px icon plus its own button padding, matching the collapsed
// icon-only look the space panel's own apps use.
const SIDEBAR_MAX_WIDTH = 240;
const SIDEBAR_MIN_WIDTH = 72;
// Below this, treat the sidebar as "collapsed" (icon-only) rather than showing a squeezed label —
// a bit above the hard minimum so it snaps into icon-only mode before the label gets uncomfortably
// clipped while still dragging.
const SIDEBAR_COLLAPSE_THRESHOLD = 120;
const SIDEBAR_WIDTH_STORAGE_KEY = "social_sidebar_width";

function loadSidebarWidth(): number {
    const stored = parseInt(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY) ?? "", 10);
    if (isNaN(stored)) return SIDEBAR_MAX_WIDTH;
    return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, stored));
}

type SocialSection = "feed" | "groups" | "profile";

interface SocialNav {
    section: SocialSection;
    roomId?: string;
    /** Set when viewing a user whose linked profile room can't be resolved to a real Room object —
     *  either they have none at all (or an invalid one) or it's invite-only/private. Shows a
     *  profile-shaped placeholder page for that user (their own live avatar/displayname, no posts)
     *  instead of a real room. `reason` distinguishes "never made one"/"invalid" from "exists but
     *  you can't see it" so the placeholder can say the right thing. Mutually exclusive with
     *  roomId/roomPreview in practice; kept separate so this is unambiguous from "room not found". */
    viewUserId?: string;
    viewUserReason?: "no_profile" | "private";
    /** Set when the user's profile room is public-or-knockable but couldn't be (fully) peeked —
     *  no Room object exists, just what its public summary revealed. Shows a lighter, summary-only
     *  profile page with a Follow/Request Follow call to action instead of SocialRoomView's full
     *  rendering (which needs a real Room). Mutually exclusive with roomId/viewUserId. */
    roomPreview?: {
        userId: string;
        roomId: string;
        joinRule: "public" | "knock";
        name?: string;
        avatarUrl?: string;
        topic?: string;
        roomType?: string;
    };
}

interface SocialPost {
    event: MatrixEvent;
    room: Room;
    /** This user's own 👍 reaction event id on this post, if any — undefined when not liked. */
    myLikeEventId: string | undefined;
    /** This user's own 🔁 reaction event id on this post, if any — undefined when not reposted. */
    myRepostEventId: string | undefined;
    replyCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SOCIAL_ROOM_EVENT_TYPES = new Set(["m.room.message", "m.sticker", M_POLL_START.name, M_POLL_START.altName]);

function isFeedEvent(event: MatrixEvent, room: Room, filter: SocialFeedFilter): boolean {
    // getWireContent(), not getContent() - the latter substitutes an edited event's body with
    // its latest replacement content, which drops the original m.relates_to entirely (m.new_content
    // never carries relation data), so relation checks must always read the untouched wire content.
    const relates = event.getWireContent()?.["m.relates_to"];
    // Reactions/likes (m.annotation) are never posts, but thread replies now show as their own
    // feed entries too — RepliedToIndicator (driven by the same event's m.in_reply_to fallback)
    // already renders "Reply to: ..." for them, same as it does in the standalone thread view.
    if (relates?.rel_type === "m.annotation") return false;
    // An edit (m.replace) is never its own post either — MatrixEvent.getContent() already
    // transparently substitutes the target event's displayed body with the latest edit, so
    // showing the raw edit event too would just duplicate that same content as a second entry.
    // isRelation() reads the wire content, so this is reliable even for an edit that's itself
    // been superseded by a later edit.
    if (event.isRelation(RelationType.Replace)) return false;
    if (senderExcludedFromFeed(event.getSender() ?? null, filter)) return false;

    const type = event.getType();
    if (type === MSC4501_EVENT_POST) return true;
    // Stickers, polls (and plain messages, e.g. sent via the stock Upload button) sent from the
    // composer button row are real independent Matrix events, not m.room.message wrapped in our
    // own post schema — still feed-worthy if they landed in a room the feed filter includes.
    if (SOCIAL_ROOM_EVENT_TYPES.has(type) && roomCountsForFeed(room, filter)) return true;
    return false;
}

function aggregatePosts(rooms: Room[], myUserId: string, filter: SocialFeedFilter): SocialPost[] {
    const posts: SocialPost[] = [];
    // Each event's position within its OWN room's gatherRoomEvents() result - the room's true
    // timeline/DAG order, independent of its claimed origin_server_ts. Used below as a tiebreaker
    // when getTs() is equal (e.g. a bridge backfilling several posts in the same room with one
    // shared batch timestamp - see the "reposted X's post" identical-timestamp bug this fixes).
    const timelineIndex = new Map<string, number>();

    for (const room of rooms) {
        if (room.getMyMembership() !== KnownMembership.Join) continue;
        if (!roomCountsForFeed(room, filter)) continue;

        const events = gatherRoomEvents(room);
        events.forEach((e, i) => {
            const id = e.getId();
            if (id) timelineIndex.set(id, i);
        });

        for (const event of events) {
            if (!isFeedEvent(event, room, filter)) continue;
            const eid = event.getId()!;
            // Read my own like/repost state via the room's own relations aggregation
            // (room.relations.getChildEventsForEvent), not by scanning `events` for annotations
            // pointing at eid - reaction events aren't reliably present in a plain room-events scan
            // the way the main timeline's own messages are (Synapse can aggregate/report a
            // reaction's *count* without that specific reaction event ever landing in a synced
            // timeline window), which is why a like/repost sent in an earlier session stopped
            // showing as "mine" here after navigating away and back, despite the reaction pill's
            // own count (built from this same relations aggregation) still showing correctly.
            const reactions = room.relations.getChildEventsForEvent(eid, RelationType.Annotation, EventType.Reaction);
            const myReactions = getMyReactions(reactions, myUserId) ?? [];
            const myLikeEventId = myReactions.find((e) => e.getContent()?.["m.relates_to"]?.key === "👍")?.getId();
            const myRepostEventId = myReactions.find((e) => e.getContent()?.["m.relates_to"]?.key === "🔁")?.getId();
            posts.push({
                event,
                room,
                myLikeEventId,
                myRepostEventId,
                // replyCountFor uses matrix-js-sdk's own authoritative Thread.length (matching
                // stock Element's own thread-summary badge) when `event` is a recognized thread
                // root, so the total shown here always matches whatever the same event shows in
                // Room view or the opened thread view - instead of each view hand-rolling its own,
                // potentially-drifting count. Falls back to counting direct replies only for a
                // non-root reply surfaced as its own feed entry (Social has no "total size" concept
                // for those - see this file's own isFeedEvent comment on why they appear at all).
                replyCount: replyCountFor(event, room, [events]),
            });
        }
    }

    return posts.sort((a, b) => {
        const tsDiff = b.event.getTs() - a.event.getTs();
        if (tsDiff !== 0) return tsDiff;
        return (timelineIndex.get(b.event.getId()!) ?? 0) - (timelineIndex.get(a.event.getId()!) ?? 0);
    });
}

/** True when the post is in a profile room and the sender is the profile owner. Uses the room's
 *  true owner (see getProfileOwnerUserId), not just m.room.create's creator, since a bridge-
 *  provisioned profile room's creator isn't always the actual owner. */
function isProfilePostByOwner(event: MatrixEvent, room: Room): boolean {
    const owner = getProfileOwnerUserId(room);
    return !!owner && event.getSender() === owner;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SocialHomeView(): JSX.Element {
    const client = useMatrixClientContext();
    const myUserId = client.getUserId() ?? "";
    const sdkContext = useContext(SDKContext);
    const profileRoomId = useProfileRoomLink(client, myUserId);
    // .social_Content itself persists across Feed <-> thread-view transitions (only its children
    // get swapped/unmounted) - see FeedPane's own use of this for scroll-position save/restore.
    const contentRef = useRef<HTMLElement>(null);
    // Window-level drag-and-drop for the whole app - see useWindowFileDrop's own doc. Mounted once
    // here (SocialHomeView is the root of the whole Social app) rather than per-composer.
    const isDraggingFile = useWindowFileDrop();
    // haven apps-framework patch: when the spaces bar is hidden, its own Home meta-space button
    // isn't visible either, so there'd be no way back to the regular (non-app) view without this.
    const showSpacesBar = useSettingValue("Haven.showSpacesBar");
    // Captured once, on mount - whichever room (if any) was open in stock Element's chat view right
    // before switching to Social, so the sidebar's "Chat" button can return there instead of always
    // landing on the generic home screen. A lazy initializer (not a mount effect) specifically so
    // this reads RoomViewStore's state before anything Social does on mount (e.g. its own internal
    // room navigation for profile/group posts) has a chance to move it - captured once here, then
    // never re-read, so Social's own subsequent room views don't overwrite what "back" means.
    const [returnToRoomId] = useState(() => sdkContext.roomViewStore.getRoomId());
    const [feedFilter, setFeedFilter] = useState<SocialFeedFilter>(() => loadSocialFeedFilter(client));

    // Lazy initializer (not a plain { section: "feed" }): a "social/groups" or "social/profile"
    // deep link (see permalinkRouting.ts's tryRouteSocialHashScreen) sets this before dispatching
    // SOCIAL_HOME_ACTION to mount this component in the first place - see pendingSocialSection.ts
    // for why the initializer (not a mount effect) is what has to read it.
    const [nav, setNav] = useState<SocialNav>(() => {
        const section = peekPendingSocialSection();
        return section ? { section } : { section: "feed" };
    });

    // Clears the bridge read above - see pendingSocialSection.ts for why this is safe to do from a
    // plain mount effect (unlike consuming it directly in the initializer) despite StrictMode
    // double-invoking mount effects. Without this, closing Social and reopening it later with no
    // new deep link would incorrectly reapply a stale section from a much earlier link click.
    useEffect(() => {
        clearPendingSocialSection();
    }, []);

    // "#/social?post=1[&body=...]" (see tryRouteSocialHashScreen) opens the Post composer directly,
    // optionally prefilled, once mounted - pendingPostModal.ts explains why a destructive consume is
    // safe here specifically (unlike pendingViewUserId's identical-looking but state-setting
    // consume below), since this only ever triggers a Modal.createDialog call.
    useEffect(() => {
        const pending = consumePendingPostModal();
        if (pending) {
            Modal.createDialog(PostDialog, { client, initialBody: pending.body }, "social_PostDialog_wrapper");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // A "View Profile" click from the stock member RightPanel (see the mount effect below) mounts
    // this component fresh with a pending userId waiting to be resolved - nav's own default above is
    // unconditionally "feed", so without this, Feed would render for the entire (real network round
    // trip - getProfileRoomLink then resolveProfileRoom) stretch before handleViewUser's resolution
    // finally lands and switches nav away from its default. Peeked (not consumed) here since the
    // mount effect still needs to consume it exactly once for the actual resolution; cleared for
    // good once handleViewUser's resolution completes (see there), so a later, ordinary visit to the
    // Feed tab (nav genuinely back to its all-default shape) never gets misread as still-resolving.
    const [resolvingPendingUser, setResolvingPendingUser] = useState(() => peekPendingViewUserId() !== null);

    // URL-bar sync for nav states no more specific component owns the hash for: FeedPane
    // (nav.section === "feed") and SocialRoomView (nav.roomId set, or nav.section === "profile"
    // once ProfilePane resolves an actual profile room) each write their own, more specific
    // "social/room/!id[/$eventId]" hash via their own identical effect - writing here too for those
    // same states would race it (React runs child effects before parent ones on the same commit,
    // so this one would run *after* and clobber whatever the child just wrote). Groups gets its own
    // distinct "social/groups" (see tryRouteSocialHashScreen); Profile gets "social/profile" only
    // while still unresolved (profileRoomId falsy) - once it resolves to a real room, SocialRoomView
    // (via ProfilePane) takes over with the room's own more specific hash, same deferral as above.
    // Everything else (viewing a user's placeholder profile, a room preview) has no more specific
    // hash of its own - "social" is the correct, generic one.
    useEffect(() => {
        if (nav.roomId || nav.section === "feed") return;
        if (nav.section === "profile") {
            if (profileRoomId) return;
            onNewScreen("social/profile");
            return;
        }
        if (nav.section === "groups") {
            onNewScreen("social/groups");
            return;
        }
        onNewScreen("social");
    }, [nav.roomId, nav.section, profileRoomId]);

    const [rooms, setRooms] = useState<Room[]>(() => client.getRooms());
    const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
    const setUserMenuPortalTarget = useSetUserMenuPortalTarget();
    const sidebarCollapsed = sidebarWidth < SIDEBAR_COLLAPSE_THRESHOLD;
    // re-resizable's `delta` is cumulative from resize start, not incremental per event — track the
    // width resizing began at so each callback computes an absolute width instead of drifting by
    // re-adding an already-cumulative delta on top of a value it was previously used to derive.
    const resizeStartWidthRef = useRef(sidebarWidth);

    // Clicking a sender anywhere in the feed opens Element's real stock member-info right panel
    // (the same RightPanelStore + <RightPanel> used by normal rooms), scoped to the room the
    // clicked post came from — not a bespoke overlay. RightPanelStore keys its state per room id
    // (see isOpenForRoom/setCards), so we track which room's panel is current ourselves; Social
    // Feed has no single "current room" the way RoomView does.
    //
    // Notifications is deliberately NOT routed through RightPanelStore at all (earlier attempts
    // used a sentinel "room id" so RightPanelStore's isPhaseValid() wouldn't reject a roomless
    // phase — see git history) — that approach corrupted the *shared, per-account* RightPanelStore
    // singleton: emitAndUpdateSettings() persists/reads relative to `viewedRoomId`, and any
    // ambient (no-explicit-roomId) call elsewhere — e.g. a normal room's own avatar-click opening
    // MemberInfo via showOrHidePhase() — resolves its target room id from that same
    // `viewedRoomId`. If it was ever left pointing at our sentinel, clicks in a REAL room after
    // leaving Social silently wrote into the sentinel's bucket instead of the real room's,
    // reproducing exactly as "stuck showing Notifications, can't open anything else" once back in
    // a normal room. NotificationPanel only ever needed an `onClose` prop (see its own IProps) —
    // rendering it directly, wrapped in the same plain markup RightPanel.tsx itself uses, avoids
    // RightPanelStore entirely for this case and can't leak into real rooms' state.
    const [rightPanelRoomId, setRightPanelRoomId] = useState<string | null>(null);
    const [notificationsOpen, setNotificationsOpen] = useState(false);

    useEffect(() => {
        const onRightPanelStoreUpdate = (): void => {
            setRightPanelRoomId((cur) =>
                cur !== null && sdkContext.rightPanelStore.isOpenForRoom(cur) ? cur : null,
            );
        };
        sdkContext.rightPanelStore.on(UPDATE_EVENT, onRightPanelStoreUpdate);
        return () => {
            sdkContext.rightPanelStore.off(UPDATE_EVENT, onRightPanelStoreUpdate);
        };
    }, [sdkContext]);

    const openRightPanelForRoom = useCallback(
        (room: Room, phase: RightPanelPhases, state: Record<string, unknown> = {}) => {
            setNotificationsOpen(false);
            // Visibility here is entirely gated by rightPanelRoomId (see rightPanelRoom below,
            // which decides whether <RightPanel> even mounts) rather than rightPanelStore's own
            // isOpen/togglePanel - setCards always forces isOpen: true unconditionally, so calling
            // it again for the same room+phase just kept it open instead of closing it. Toggle by
            // clearing rightPanelRoomId when the same room+phase is already showing.
            const alreadyShowingThis =
                rightPanelRoomId === room.roomId &&
                sdkContext.rightPanelStore.currentCardForRoom(room.roomId)?.phase === phase;
            if (alreadyShowingThis) {
                setRightPanelRoomId(null);
                return;
            }
            sdkContext.rightPanelStore.setCards([{ phase, state }], true, room.roomId);
            setRightPanelRoomId(room.roomId);
        },
        [sdkContext, rightPanelRoomId],
    );

    const viewRoom = useCallback((roomId: string) => {
        // A plain "go to this room" - not "go to this room, focused on this specific post". Clear
        // any leftover focus target from an earlier, unrelated navigation (see
        // clearPendingFocusEvent's own doc) so SocialRoomView opens at the top, not an old thread.
        clearPendingFocusEvent();
        setNav((prev: SocialNav) => ({ section: prev.section, roomId }));
    }, []);

    // Never opens the stock member-info right panel — clicking a user anywhere in Social always
    // attempts to go straight to their Social profile instead. If they've linked a profile room
    // (org.matrix.msc4501.social.profile_room_id), navigate to it directly; otherwise show a
    // profile-shaped placeholder page for that user (their own live avatar/displayname, no posts —
    // see SocialUserProfileView) rather than falling back to the right panel.
    const handleViewUser = useCallback(
        (userId: string) => {
            void getProfileRoomLink(client, userId).then(async (profileRoomId) => {
                const resolution = await resolveProfileRoom(client, profileRoomId);
                switch (resolution.kind) {
                    case "room":
                        // profileRoomId is non-null here — "room" is only returned once
                        // client.getRoom(profileRoomId) succeeds (already joined, or just peeked).
                        viewRoom(profileRoomId!);
                        break;
                    case "preview":
                        setNav((prev: SocialNav) => ({
                            section: prev.section,
                            roomPreview: {
                                userId,
                                roomId: profileRoomId!,
                                joinRule: resolution.joinRule,
                                name: resolution.name,
                                avatarUrl: resolution.avatarUrl,
                                topic: resolution.topic,
                                roomType: resolution.roomType,
                            },
                        }));
                        break;
                    case "private":
                        setNav((prev: SocialNav) => ({ section: prev.section, viewUserId: userId, viewUserReason: "private" }));
                        break;
                    case "invalid":
                        setNav((prev: SocialNav) => ({ section: prev.section, viewUserId: userId, viewUserReason: "no_profile" }));
                        break;
                }
                // No-op for every caller except the pending-user mount case above - see
                // resolvingPendingUser's own doc for why this needs clearing once resolved.
                setResolvingPendingUser(false);
                // FeedPane's own thread view (its `threadView` local state, see closeThreadToken's
                // own doc there) is invisible to `nav` - every branch above already updated `nav`
                // correctly, but clicking a sender's name *from inside* FeedPane's thread panel left
                // that panel showing regardless, since nothing had ever told it to close. Bumping the
                // same token used for hash-driven resets closes it here too, whichever of the four
                // outcomes above this call resolved to. Harmless when this call didn't originate from
                // FeedPane's thread view at all (a currently-unmounted or already-closed FeedPane just
                // ignores it).
                setCloseThreadToken((t) => t + 1);
            });
        },
        [client, viewRoom],
    );

    // Clicking a post's own avatar opens the stock member-info RightPanel instead - the same
    // distinction stock Element draws between clicking a name (navigate) vs. an avatar (member
    // card). Needs a real matrix-js-sdk RoomMember (not just a userId) - see the MemberList dispatch
    // fix above for why a plain DTO object won't do for this same MemberInfo card.
    const handleOpenUserPanel = useCallback(
        (userId: string, targetRoom: Room) => {
            const member = targetRoom.getMember(userId);
            if (member) openRightPanelForRoom(targetRoom, RightPanelPhases.MemberInfo, { member });
        },
        [openRightPanelForRoom],
    );

    // Picks up a Profile-button click from the stock member RightPanel (see
    // SocialProfileButton.tsx / pendingViewUser.ts) — that button dispatches SOCIAL_HOME_ACTION to
    // get here in the first place, so by the time this mounts the click has already happened and
    // there's no dispatch left to listen for; this plain module value is what survives the trip.
    useEffect(() => {
        const pending = consumePendingViewUserId();
        if (pending) handleViewUser(pending);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Same hand-off as pendingViewUserId above, but for a matrix.to/matrix: link to a room that
    // turned out to be a Social profile/group - see permalinkRouting.ts. With an event ID, reuses
    // the exact same peek/join/knock/private resolution a repost/cross-reply header line's click
    // already needs (resolveAndOpenPost) - once resolved, the event to focus is handed off again
    // (pendingFocusEvent.ts) for SocialRoomView to pick up on its own mount, since it owns the
    // room-level thread view state itself, not SocialHomeView. Without an event ID (a bare room
    // link), resolveProfileRoom's own already-generic room/preview/private/invalid resolution (the
    // same thing handleViewUser uses) decides between going straight to the room, a
    // follow-to-see preview page, or a private notice.
    //
    // Pulled out to its own function (rather than inline in the mount effect below) because it also
    // needs to run every time SOCIAL_HOME_ACTION is dispatched while already mounted, not just once
    // on mount - browser back/forward onto a "social/room/!id[/$eventId]" hash (see routing.ts's
    // tryRouteSocialHashScreen) sets this exact same pendingViewPost bridge and re-dispatches
    // SOCIAL_HOME_ACTION, but if Social is already the active app, that dispatch doesn't cause a
    // remount - nothing would ever consume the newly-set pending post without this also being
    // wired into the always-on useDispatcher below.
    const consumePendingPost = useCallback(() => {
        const pending = consumePendingViewPost();
        if (!pending) return false;
        const { roomId, eventId } = pending;
        if (eventId) {
            resolveAndOpenPost(client, roomId, eventId, undefined, (event, room) => {
                // viewRoom() itself clears any pending focus event - set this one after, not
                // before, so it isn't immediately wiped out by that same clear.
                viewRoom(room.roomId);
                setPendingFocusEvent(event);
            });
            return true;
        }
        void resolveProfileRoom(client, roomId).then((resolution) => {
            switch (resolution.kind) {
                case "room":
                    viewRoom(roomId);
                    break;
                case "preview":
                    setNav((prev: SocialNav) => ({
                        section: prev.section,
                        roomPreview: {
                            userId: "",
                            roomId,
                            joinRule: resolution.joinRule,
                            name: resolution.name,
                            avatarUrl: resolution.avatarUrl,
                            topic: resolution.topic,
                            roomType: resolution.roomType,
                        },
                    }));
                    break;
                case "private":
                case "invalid":
                    showPrivateProfileModal();
                    break;
            }
        });
        return true;
    }, [client, viewRoom]);

    useEffect(() => {
        consumePendingPost();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Forces FeedPane to close any open thread view when a hash-driven navigation to bare "social"
    // (no room) lands while Social is already mounted - see closeThreadToken's own doc on FeedPane's
    // props. Bumped (not booleaned) so two consecutive resets each still register as a change even
    // if nothing else about the props differs.
    const [closeThreadToken, setCloseThreadToken] = useState(0);

    // Set once a pendingFeedThread resolves (see below) - passed down to FeedPane so it can reopen
    // its own thread panel for this exact post, the same way clicking it there would. A plain object
    // (not a token) since FeedPane's own effect keys off the resolved event's identity directly.
    const [openThreadTarget, setOpenThreadTarget] = useState<{ event: MatrixEvent; room: Room } | null>(null);

    // Handles SOCIAL_HOME_ACTION re-dispatched while Social is already the active app - critically,
    // this is the *only* time a plain page_type switch (LoggedInView.tsx) wouldn't itself cause
    // SocialHomeView to remount and pick up a fresh pendingViewPost/pendingViewUserId via the mount
    // effect above. Four cases, checked in order: a pendingViewUserId (a "View Profile" RightPanel
    // click - see below) is consumed the same way the mount effect does; a pendingFeedThread
    // (browser back/forward onto a "social/room/!id/$eventId" hash whose history entry was stamped
    // "feed" - see socialHistoryOrigin.ts) means reopening that post in FeedPane's own thread panel,
    // not the dedicated room page; a plain pendingViewPost (everything else that ever sets one) is
    // also consumed the same way the mount effect does; nothing pending at all (bare "social") means
    // reset to the feed and close whatever thread might be open.
    useDispatcher(defaultDispatcher, (payload) => {
        if (payload.action !== SOCIAL_HOME_ACTION) return;
        // A "View Profile" click from the stock member RightPanel (see SocialProfileButton.tsx)
        // dispatches this same action, same as when Social isn't mounted yet - but if Social is
        // already the active app (e.g. the RightPanel was opened via a post's own avatar - see
        // onOpenUserPanel), this handler runs instead of the one-time mount effect above, which is
        // the only other place that ever consumes a pending view-user. Missing this check here meant
        // the click silently did nothing (fell through to the bare "social" case below, resetting to
        // Feed) instead of actually navigating anywhere.
        const pendingUser = consumePendingViewUserId();
        if (pendingUser) {
            handleViewUser(pendingUser);
            return;
        }
        const feedThread = consumePendingFeedThread();
        if (feedThread) {
            setNav({ section: "feed" });
            resolveAndOpenPost(client, feedThread.roomId, feedThread.eventId, undefined, (event, room) => {
                setOpenThreadTarget({ event, room });
            });
            return;
        }
        if (consumePendingPost()) return;
        // Same reasoning as pendingSection just below, for a "#/social?post=1[&body=...]" deep
        // link re-dispatching this action while Social is already open - the mount effect that
        // normally consumes this never runs again for an already-mounted component.
        const pendingModal = consumePendingPostModal();
        if (pendingModal) {
            Modal.createDialog(PostDialog, { client, initialBody: pendingModal.body }, "social_PostDialog_wrapper");
            return;
        }
        // A "social/groups"/"social/profile" deep link (see tryRouteSocialHashScreen) re-dispatches
        // this same action while Social is already the active app - the mount-time lazy initializer
        // that normally reads this bridge (see nav's own useState above) never runs again for an
        // already-mounted component, so without this check here too it fell through to the bare
        // "social" case just below, resetting to Feed instead of actually switching tabs.
        const pendingSection = peekPendingSocialSection();
        if (pendingSection) {
            clearPendingSocialSection();
            setNav({ section: pendingSection });
            return;
        }
        setNav({ section: "feed" });
        setCloseThreadToken((t) => t + 1);
    });

    // User pills (matrix.to user mentions) inside post bodies dispatch the same stock
    // Action.ViewUser that clicking a sender's name in the normal room timeline does (see
    // usePermalink.ts) — normally caught by RoomView.tsx, which Social never renders, so nothing
    // would otherwise handle it. Reroute it through the exact same handleViewUser logic used for
    // the post header's own sender-name click. Only fires for a pill whose RoomMember actually
    // resolved (see usePermalink.ts) and stopped the event there — an unresolved pill's click still
    // bubbles to SocialEventTile's own handleBodyClick, which calls onViewUser directly instead.
    //
    // Clicking a member row in the stock MemberList (opened via the Followers/Members pill — see
    // SocialRoomView.tsx) dispatches this exact same action (see MemberTileViewModel.tsx), with no
    // way to tell the two sources apart from the payload alone. RoomView.tsx would normally turn
    // that into a MemberInfo card push; unlike the pill case, that raw member card (verification
    // status, admin tools, etc.) is what a MemberList click should still show — redirecting it into
    // a Social profile instead would make Browse-the-member-list useless for anything but that.
    // Detected by checking whether the RightPanel is currently showing MemberList for this member's
    // room, and if so, replicate RoomView.tsx's own push instead of calling handleViewUser.
    //
    // payload.member is only a real matrix-js-sdk RoomMember class instance for the pill case
    // (usePermalinkMember.ts always constructs or fetches one) - MemberTileViewModel.tsx dispatches
    // a plain object matching Element's own newer models/rooms/RoomMember *type* instead (a
    // lightweight DTO, not a class), so `instanceof RoomMember` never matched a MemberList click and
    // this whole handler silently did nothing for it. Checked by shape (both have userId/roomId)
    // instead, then re-resolved into a real RoomMember from the room before pushing MemberInfo,
    // since that stock card expects the real class (getMxcAvatarUrl, powerLevel, etc.), not the DTO.
    useDispatcher(defaultDispatcher, (payload) => {
        if (payload.action !== Action.ViewUser) return;
        const member = payload.member as { userId?: string; roomId?: string } | undefined;
        if (!member?.userId) return;

        const roomId = member.roomId;
        if (roomId && sdkContext.rightPanelStore.currentCardForRoom(roomId).phase === RightPanelPhases.MemberList) {
            const realMember = client.getRoom(roomId)?.getMember(member.userId);
            if (realMember) {
                sdkContext.rightPanelStore.pushCard(
                    { phase: RightPanelPhases.MemberInfo, state: { member: realMember } },
                    true,
                    roomId,
                );
            }
            return;
        }

        handleViewUser(member.userId);
    });

    // Stock Element loads a room's membership (room.loadMembersIfNeeded()) as a side effect of
    // opening it via RoomView/MessageComposer — see loadMembersIfNeeded's other call sites. Social
    // replaces that navigation UI entirely, and useBackfillSocialRooms only loads membership for
    // rooms that qualify for the feed, so any other joined room (e.g. ordinary chat rooms, bridged
    // rooms) never gets its membership loaded at all anymore. NotificationPanel aggregates
    // notifications from every joined room via a real EventTile-based TimelinePanel, which resolves
    // a sender's avatar from that same membership data — without it, most notification rows render
    // with no avatar at all. Load membership for every joined room once, the first time
    // Notifications is actually opened (not eagerly on mount, since this can be dozens of rooms).
    const loadedAllMembersRef = useRef(false);
    const toggleNotifications = useCallback(() => {
        setNotificationsOpen((wasOpen) => {
            if (!wasOpen) {
                setRightPanelRoomId(null);
                if (!loadedAllMembersRef.current) {
                    loadedAllMembersRef.current = true;
                    for (const room of client.getRooms()) {
                        void room.loadMembersIfNeeded();
                    }
                }
            }
            return !wasOpen;
        });
    }, [client]);

    const rightPanelRoom = rightPanelRoomId ? client.getRoom(rightPanelRoomId) : null;
    const rightPanel = notificationsOpen ? (
        <aside className="mx_RightPanel" id="mx_RightPanel" data-testid="right-panel">
            <NotificationPanel onClose={() => setNotificationsOpen(false)} />
        </aside>
    ) : rightPanelRoom ? (
            <RightPanel
                room={rightPanelRoom}
                resizeNotifier={sdkContext.resizeNotifier}
                permalinkCreator={new RoomPermalinkCreator(rightPanelRoom)}
            />
        ) : undefined;

    // Social rooms are never opened via the normal RoomView, so nothing else
    // ever paginates their timelines beyond the initial sync window — backfill
    // them here so the feed has real history instead of large gaps. Also loads
    // room membership (see hook doc) so user pills can resolve avatars/names;
    // pillsGeneration is threaded down as a prop and used only to key the small
    // pill-bearing body div inside SocialEventTile (see its Props doc) — not the
    // whole tile/room view, so remounting to refresh pills never interrupts
    // playing media or resets any other tile/composer state.
    const {
        generation: pillsGeneration,
        hasMore: hasMoreHistory,
        loadMore: loadMoreHistory,
    } = useBackfillSocialRooms(rooms, client, feedFilter);

    // A background rooms refresh (someone else liking/reposting/replying anywhere, or a room's
    // history backfilling in) rebuilds every pane's posts from scratch - matrix-js-sdk's own
    // timeline windowing during a backfill-in-progress can genuinely show fewer events for one
    // intermediate render before growing back to the full set. If that transient shrink drops the
    // scrollable height below the current scroll position, the browser clamps scrollTop down to
    // fit - usually all the way to 0 - discarding the user's actual scroll position (see
    // SocialRoomView.tsx's own identical fix/comment for the profile/group-page half of this same
    // bug - "the scroll-to-top button shows briefly then disappears"). Snapshot/restore scrollTop
    // around every refresh so a transient shrink never loses it - useLayoutEffect so the restore
    // applies before the browser paints the shrunk-then-regrown content.
    const preRoomsRefreshScrollTop = useRef<number | null>(null);
    useLayoutEffect(() => {
        if (preRoomsRefreshScrollTop.current !== null && contentRef.current) {
            contentRef.current.scrollTop = preRoomsRefreshScrollTop.current;
            preRoomsRefreshScrollTop.current = null;
        }
    }, [rooms]);

    useEffect(() => {
        const refresh = (): void => {
            preRoomsRefreshScrollTop.current = contentRef.current?.scrollTop ?? null;
            setRooms(client.getRooms());
        };
        client.on("Room" as any, refresh);
        client.on("Room.myMembership" as any, refresh);
        client.on("Room.timeline" as any, refresh);
        return () => {
            client.off("Room" as any, refresh);
            client.off("Room.myMembership" as any, refresh);
            client.off("Room.timeline" as any, refresh);
        };
    }, [client]);

    const navigateToProfile = useCallback(() => {
        setNav({ section: "profile" });
    }, []);

    const closeRoom = useCallback(() => {
        setNav((prev: SocialNav) => ({ section: prev.section }));
    }, []);

    let mainContent: JSX.Element;

    // See resolvingPendingUser's own doc - still-default nav (no roomId/viewUserId/roomPreview yet)
    // while a pending "View Profile" click's own resolution is still in flight shows a neutral
    // spinner instead of Feed, which nav's own unconditional "feed" default would otherwise show.
    if (resolvingPendingUser && !nav.roomId && !nav.viewUserId && !nav.roomPreview) {
        mainContent = (
            <div className="social_ContentEmpty">
                <Spinner />
            </div>
        );
    } else if (nav.viewUserId) {
        mainContent = (
            <SocialUserProfileView
                key={nav.viewUserId}
                userId={nav.viewUserId}
                reason={nav.viewUserReason}
                onBack={closeRoom}
            />
        );
    } else if (nav.roomPreview) {
        mainContent = (
            <SocialProfilePreview
                key={nav.roomPreview.roomId}
                client={client}
                userId={nav.roomPreview.userId}
                roomId={nav.roomPreview.roomId}
                joinRule={nav.roomPreview.joinRule}
                name={nav.roomPreview.name}
                avatarUrl={nav.roomPreview.avatarUrl}
                topic={nav.roomPreview.topic}
                roomType={nav.roomPreview.roomType}
                onBack={closeRoom}
                onFollowed={viewRoom}
            />
        );
    } else if (nav.roomId) {
        const room = client.getRoom(nav.roomId);
        mainContent = room ? (
            <SocialRoomView
                key={nav.roomId}
                room={room}
                onBack={closeRoom}
                pillsGeneration={pillsGeneration}
                onViewUser={handleViewUser}
                onOpenUserPanel={handleOpenUserPanel}
                onOpenRoomPanel={openRightPanelForRoom}
                onNavigateToProfile={navigateToProfile}
                scrollContainerRef={contentRef}
                onRoomClick={viewRoom}
                closeThreadToken={closeThreadToken}
            />
        ) : (
            <div className="social_ContentEmpty">Room not found.</div>
        );
    } else if (nav.section === "feed") {
        mainContent = (
            <FeedPane
                rooms={rooms}
                myUserId={myUserId}
                profileRoomId={profileRoomId}
                client={client}
                scrollContainerRef={contentRef}
                pillsGeneration={pillsGeneration}
                hasMoreHistory={hasMoreHistory}
                onLoadMoreHistory={loadMoreHistory}
                onViewRoom={viewRoom}
                onViewUser={handleViewUser}
                onOpenUserPanel={handleOpenUserPanel}
                onRefresh={() => setRooms([...client.getRooms()])}
                filter={feedFilter}
                onFilterChange={setFeedFilter}
                onNavigateToProfile={navigateToProfile}
                closeThreadToken={closeThreadToken}
                openThreadTarget={openThreadTarget}
            />
        );
    } else if (nav.section === "groups") {
        mainContent = (
            <GroupsPane
                rooms={rooms}
                client={client}
                onViewRoom={viewRoom}
                onRefresh={() => setRooms(client.getRooms())}
            />
        );
    } else {
        mainContent = (
            <ProfilePane
                rooms={rooms}
                profileRoomId={profileRoomId}
                client={client}
                pillsGeneration={pillsGeneration}
                onViewRoom={viewRoom}
                onViewUser={handleViewUser}
                onOpenUserPanel={handleOpenUserPanel}
                onOpenRoomPanel={openRightPanelForRoom}
                closeThreadToken={closeThreadToken}
                onRefresh={() => setRooms(client.getRooms())}
                scrollContainerRef={contentRef}
            />
        );
    }

    // Reset scroll position on navigating to a genuinely different page - .social_Content itself
    // persists across every Social nav transition (see contentRef's own doc above), so without this
    // the browser leaves whatever scroll offset the *previous* page had in place, landing the new
    // page's content wherever that old offset happens to sit rather than at its own top. This is
    // what "clicking a name sometimes lands partway down their profile" actually turned out to be -
    // unrelated to (and independent of) the separate pendingFocusEvent staleness bug fixed above,
    // which only mattered for the "specific post" case, not this "everything scrolled" case.
    const contentIdentity = nav.viewUserId
        ? `user:${nav.viewUserId}`
        : nav.roomPreview
          ? `preview:${nav.roomPreview.roomId}`
          : nav.roomId
            ? `room:${nav.roomId}`
            : `section:${nav.section}`;
    useLayoutEffect(() => {
        if (contentRef.current) contentRef.current.scrollTop = 0;
    }, [contentIdentity]);

    return (
        <MainSplit panel={rightPanel} defaultSize={420} analyticsRoomType="user_profile">
            <div className="social_Layout">
                <NotificationsButton onToggle={toggleNotifications} />
                <Resizable
                    className="social_Sidebar_resizeWrapper"
                    size={{ width: sidebarWidth, height: "100%" }}
                    minWidth={SIDEBAR_MIN_WIDTH}
                    maxWidth={SIDEBAR_MAX_WIDTH}
                    enable={{
                        top: false,
                        right: true,
                        bottom: false,
                        left: false,
                        topRight: false,
                        bottomRight: false,
                        bottomLeft: false,
                        topLeft: false,
                    }}
                    handleClasses={{ right: "mx_ResizeHandle--horizontal" }}
                    onResizeStart={() => {
                        resizeStartWidthRef.current = sidebarWidth;
                    }}
                    onResize={(_e, _dir, _ref, delta) =>
                        setSidebarWidth(
                            Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, resizeStartWidthRef.current + delta.width)),
                        )
                    }
                    onResizeStop={(_e, _dir, _ref, delta) => {
                        const finalWidth = Math.min(
                            SIDEBAR_MAX_WIDTH,
                            Math.max(SIDEBAR_MIN_WIDTH, resizeStartWidthRef.current + delta.width),
                        );
                        window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(finalWidth));
                    }}
                >
                    <nav className="social_Sidebar">
                        {/* haven apps-framework patch: when the spaces bar is hidden, LeftPanel
                            (and its own portal target next to the search bar) is unmounted while
                            an app is open — there'd be no way back to Home/normal rooms otherwise.
                            Registers this app's own slot for the relocated top-left menu instead. */}
                        <div
                            ref={setUserMenuPortalTarget}
                            className={`haven_UserMenuPortalTarget${sidebarCollapsed ? " haven_UserMenuPortalTarget--collapsed" : ""}`}
                        />
                        {!showSpacesBar && (
                            <>
                                <NavButton
                                    icon={<ArrowLeftIcon />}
                                    label="Chat"
                                    active={false}
                                    collapsed={sidebarCollapsed}
                                    onClick={() =>
                                        returnToRoomId
                                            ? defaultDispatcher.dispatch({
                                                  action: Action.ViewRoom,
                                                  room_id: returnToRoomId,
                                              })
                                            : defaultDispatcher.dispatch({ action: Action.ViewHomePage })
                                    }
                                />
                                <div className="social_Sidebar_divider" />
                            </>
                        )}
                        <NavButton
                            icon={<PublicIcon />}
                            label="Feed"
                            active={nav.section === "feed" && !nav.roomId}
                            collapsed={sidebarCollapsed}
                            onClick={() => setNav({ section: "feed" })}
                        />
                        <NavButton
                            icon={<GroupIcon />}
                            label="Groups"
                            active={nav.section === "groups"}
                            collapsed={sidebarCollapsed}
                            onClick={() => setNav({ section: "groups" })}
                        />
                        <NavButton
                            icon={<UserProfileSolidIcon />}
                            label="Profile"
                            active={nav.section === "profile"}
                            collapsed={sidebarCollapsed}
                            onClick={() => setNav({ section: "profile" })}
                        />
                        <NavButton
                            icon={<ComposeIcon />}
                            label="Post"
                            active={false}
                            collapsed={sidebarCollapsed}
                            variant="post"
                            onClick={() => {
                                Modal.createDialog(PostDialog, { client }, "social_PostDialog_wrapper");
                            }}
                        />
                    </nav>
                </Resizable>
                <main className="social_Content" ref={contentRef}>{mainContent}</main>
                {isDraggingFile && (
                    <div className="social_DropOverlay">
                        <div className="social_DropOverlay_label">Drop file to attach</div>
                    </div>
                )}
            </div>
        </MainSplit>
    );
}

// ---------------------------------------------------------------------------
// Nav button
// ---------------------------------------------------------------------------

function NavButton({
    icon,
    label,
    active,
    collapsed,
    onClick,
    variant,
}: {
    icon: JSX.Element;
    label: string;
    active: boolean;
    collapsed: boolean;
    onClick: () => void;
    /** "post" fills it solid accent-green with white icon/text, matching /#home's "Send a Direct
     *  Message" button — see the Post button rendered below Profile. */
    variant?: "post";
}): JSX.Element {
    return (
        <button
            className={`social_NavButton${active ? " social_NavButton--active" : ""}${collapsed ? " social_NavButton--collapsed" : ""}${variant ? ` social_NavButton--${variant}` : ""}`}
            onClick={onClick}
            aria-current={active ? "page" : undefined}
            title={collapsed ? label : undefined}
        >
            {icon}
            {!collapsed && <span>{label}</span>}
        </button>
    );
}

// ---------------------------------------------------------------------------
// Feed pane
// ---------------------------------------------------------------------------

function FeedPane({
    rooms,
    myUserId,
    profileRoomId,
    client,
    scrollContainerRef,
    pillsGeneration,
    hasMoreHistory,
    onLoadMoreHistory,
    onViewRoom,
    onViewUser,
    onOpenUserPanel,
    onRefresh,
    filter,
    onFilterChange,
    onNavigateToProfile,
    closeThreadToken,
    openThreadTarget,
}: {
    rooms: Room[];
    myUserId: string;
    profileRoomId: string | null | undefined;
    client: MatrixClient;
    /** .social_Content itself - persists across Feed <-> thread-view transitions (only its
     *  children get swapped/unmounted), so its own scrollTop can be saved before opening a thread
     *  and restored once back, rather than resetting to the top the way a remount would. */
    scrollContainerRef: React.RefObject<HTMLElement | null>;
    pillsGeneration: number;
    hasMoreHistory: boolean;
    onLoadMoreHistory: () => Promise<void>;
    onViewRoom: (roomId: string) => void;
    onViewUser: (userId: string) => void;
    onOpenUserPanel: (userId: string, room: Room) => void;
    onRefresh: () => void;
    filter: SocialFeedFilter;
    onFilterChange: (filter: SocialFeedFilter) => void;
    onNavigateToProfile: () => void;
    /** Bumped by SocialHomeView when a hash-driven navigation to bare "social" (browser back/
     *  forward, or any other re-dispatch of SOCIAL_HOME_ACTION with nothing pending) lands while a
     *  thread is open here - threadView is this component's own local state, invisible to the
     *  parent otherwise, so there's no other way for it to force this closed. */
    closeThreadToken: number;
    /** Set by SocialHomeView once a pendingFeedThread resolves (browser back/forward onto a post
     *  that was previously viewed here, in this exact thread panel, rather than the dedicated room
     *  page - see socialHistoryOrigin.ts) - reopens that post's thread here to match. */
    openThreadTarget: { event: MatrixEvent; room: Room } | null;
}): JSX.Element {
    const posts = useMemo(() => aggregatePosts(rooms, myUserId, filter), [rooms, myUserId, filter]);

    const openFilterDialog = useCallback(() => {
        // Modal.createDialog always injects its own `onFinished` (wired to closeDialog) into the
        // dialog's props, overriding anything passed in `props` of the same name — the *only* way
        // to observe the result is the `finished` promise it returns (see e.g. createSocialRoom.ts's
        // `const [proceed, opts] = await modal.finished;` for the same pattern).
        const { finished } = Modal.createDialog(
            FeedFilterDialog,
            { client, rooms, filter },
            "social_FeedFilterDialog_wrapper",
        );
        finished.then(([saved]: [boolean?]) => {
            if (saved) onFilterChange(loadSocialFeedFilter(client));
        });
    }, [client, rooms, filter, onFilterChange]);

    // Windowed rendering: only mount the first `visibleCount` posts, growing as the user scrolls
    // near the bottom (see useLoadMoreSentinel below), instead of mounting every post already
    // loaded into memory (which can be hundreds once several rooms' history has backfilled) or
    // eagerly fetching all of a room's history up front.
    const [visibleCount, setVisibleCount] = useState(FEED_WINDOW_SIZE);
    const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);
    const [recorderSlot, setRecorderSlot] = useState<HTMLDivElement | null>(null);
    const visiblePosts = posts.slice(0, visibleCount);
    const hasMoreAlreadyLoaded = visibleCount < posts.length;

    const handleLoadMore = useCallback(async (): Promise<void> => {
        if (loadingMoreHistory) return;
        if (hasMoreAlreadyLoaded) {
            // Already have more in memory — just reveal the next chunk, no network needed.
            setVisibleCount((n) => n + FEED_WINDOW_SIZE);
            return;
        }
        if (!hasMoreHistory) return; // every joined social room is exhausted — nothing left to fetch
        // Nothing more currently loaded — fetch another page of history per room, then reveal it.
        setLoadingMoreHistory(true);
        try {
            await onLoadMoreHistory();
            setVisibleCount((n) => n + FEED_WINDOW_SIZE);
        } finally {
            setLoadingMoreHistory(false);
        }
    }, [loadingMoreHistory, hasMoreAlreadyLoaded, hasMoreHistory, onLoadMoreHistory]);

    // Keep the sentinel mounted whenever there's still something to reveal, either already in
    // memory or (potentially) from the server — not just while a fetch happens to be in flight,
    // otherwise it would unmount forever the first time memory runs out mid-session.
    const sentinelRef = useLoadMoreSentinel(handleLoadMore, hasMoreAlreadyLoaded || hasMoreHistory);

    // Local thread navigation state
    const [threadView, setThreadView] = useState<{ event: MatrixEvent; room: Room } | null>(null);
    // Skips the very first render (closeThreadToken starts at 0, same as its initial value) so this
    // doesn't fire a spurious close on mount - only actual increments (real hash-driven resets)
    // should act.
    const closeThreadTokenMounted = useRef(false);
    useEffect(() => {
        if (!closeThreadTokenMounted.current) {
            closeThreadTokenMounted.current = true;
            return;
        }
        setThreadView(null);
    }, [closeThreadToken]);

    useEffect(() => {
        if (openThreadTarget) setThreadView(openThreadTarget);
    }, [openThreadTarget]);

    // Feed scroll position, saved right before entering a thread and restored once back - see
    // scrollContainerRef's own doc for why the same .social_Content DOM node survives the trip
    // (only its children get swapped), making a plain ref (not React state - no need to re-render
    // when this changes) enough to carry it across.
    const savedFeedScrollTop = useRef<number | null>(null);
    const handleViewThread = useCallback(
        (event: MatrixEvent, room: Room) => {
            savedFeedScrollTop.current = scrollContainerRef.current?.scrollTop ?? null;
            setThreadView({ event, room });
        },
        [scrollContainerRef],
    );
    // useLayoutEffect (not useEffect) so the restored position applies before the browser paints
    // the returned-to feed, avoiding a visible flash of "scrolled to top" first.
    useLayoutEffect(() => {
        if (threadView !== null) return;
        if (savedFeedScrollTop.current !== null && scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = savedFeedScrollTop.current;
            savedFeedScrollTop.current = null;
        }
    }, [threadView, scrollContainerRef]);

    // Same URL-bar sync as SocialRoomView's own identical effect (see its comment) - a post viewed
    // from the aggregated Feed can belong to any room, not just one nav.roomId already names, so
    // this uses threadView's own room rather than something derived higher up in SocialHomeView.
    useEffect(() => {
        const eventId = threadView?.event.getId();
        onNewScreen(threadView ? `social/room/${threadView.room.roomId}/${eventId}` : "social");
        // Marks this history entry as "viewed from the Feed's own thread panel" - see
        // socialHistoryOrigin.ts's own doc. Only meaningful when a thread is actually open; bare
        // "social" has no event to disambiguate at all.
        if (threadView) stampSocialOrigin("feed");
    }, [threadView]);

    const postableRooms = useMemo(
        () =>
            rooms
                .filter(
                    (r) =>
                        r.getMyMembership() === KnownMembership.Join &&
                        (isProfileRoom(r) || isGroupRoom(r)),
                )
                .sort((a, b) => {
                    const aOwn = getProfileOwnerUserId(a) === myUserId;
                    const bOwn = getProfileOwnerUserId(b) === myUserId;
                    if (aOwn && !bOwn) return -1;
                    if (!aOwn && bOwn) return 1;
                    return a.name.localeCompare(b.name);
                }),
        [rooms, myUserId],
    );

    // The profile room is always whatever room org.matrix.msc4501.social.profile_room_id names on
    // the user's own profile (see useProfileRoomLink) - no local guessing while it's still
    // resolving, since a user can genuinely have more than one room that looks like "their"
    // profile room locally (see room-classifier.ts's own history on this), and guessing wrong is
    // worse than a brief wait.
    const myProfileRoom = useMemo(() => {
        if (!profileRoomId) return null; // still loading (undefined) or confirmed unlinked (null)
        return rooms.find((r) => r.roomId === profileRoomId) ?? null;
    }, [rooms, profileRoomId]);

    const [explicitRoomId, setExplicitRoomId] = useState("");
    // postableRooms[0] is only a reasonable fallback once profileRoomId is *confirmed* absent
    // (null) - while it's still resolving (undefined), falling back to it too showed whatever
    // unrelated profile/group room happened to be first in postableRooms (e.g. a since-unlinked
    // old profile room, still joined) for the brief moment before the real link landed, flashing
    // its avatar/name before snapping to "Your Profile" - not just "no room selected yet".
    const selectedRoomId =
        explicitRoomId || myProfileRoom?.roomId || (profileRoomId === null ? postableRooms[0]?.roomId : undefined) || "";

    const [postBody, setPostBody] = useState("");
    const [postBusy, setPostBusy] = useState(false);
    const {
        attachment: feedPendingAttachment,
        setFile: setFeedPendingFile,
        clear: clearFeedAttachment,
    } = usePendingAttachment();

    // Slash command autocomplete (see SlashCommandAutocomplete.tsx and its identical use in
    // SocialRoomView.tsx, which has the full explanation of this state).
    const feedTextareaRef = useRef<HTMLTextAreaElement>(null);
    const feedAutocompleteControlRef = useRef<SlashCommandAutocompleteHandle | null>(null);
    const [feedSelection, setFeedSelection] = useState({ start: 0, end: 0 });
    const feedPendingCursorPos = useRef<number | null>(null);
    useEffect(() => {
        if (feedPendingCursorPos.current !== null && feedTextareaRef.current) {
            feedTextareaRef.current.selectionStart = feedPendingCursorPos.current;
            feedTextareaRef.current.selectionEnd = feedPendingCursorPos.current;
            feedPendingCursorPos.current = null;
        }
    }, [postBody]);
    const updateFeedSelectionFrom = useCallback((el: HTMLTextAreaElement) => {
        setFeedSelection({ start: el.selectionStart, end: el.selectionEnd });
    }, []);
    const handleConfirmFeedCompletion = useCallback((completion: ICompletion) => {
        const { start, end } = completion.range;
        feedPendingCursorPos.current = start + completion.completion.length;
        setPostBody((body) => body.slice(0, start) + completion.completion + body.slice(end));
    }, []);
    const selectedRoomForAutocomplete = selectedRoomId ? client.getRoom(selectedRoomId) : null;

    const handleLike = useCallback(
        async (roomId: string, eventId: string, myLikeEventId: string | undefined): Promise<void> => {
            if (myLikeEventId) {
                await undoLike(client, roomId, myLikeEventId);
            } else {
                await sendLike(client, roomId, eventId);
            }
        },
        [client],
    );

    const handleReply = useCallback(
        async (roomId: string, eventId: string, body: string, file?: File): Promise<void> => {
            await sendComment(client, roomId, body, eventId, file);
        },
        [client],
    );

    const handleFeedPost = useCallback(
        async (e?: React.SyntheticEvent): Promise<void> => {
            e?.preventDefault();
            const body = postBody.trim();
            if (!body && !feedPendingAttachment) return;
            if (!selectedRoomId) return;
            // The real MSC4501 profile-room link is a network round trip (see
            // useProfileRoomLink), not a local cache read - while it's still resolving and the
            // user hasn't explicitly picked a different room themselves, selectedRoomId falls back
            // to postableRooms[0], not necessarily the user's own profile room. Posting against
            // that fallback would be a real, silent misdirected-post risk, not just a cosmetic one
            // - block sending until the real link resolves rather than risk it.
            if (!explicitRoomId && profileRoomId === undefined) return;
            setPostBusy(true);
            try {
                // A slash command is a text-only utility - doesn't make sense combined with a
                // media post, so an attachment always skips it, same as SocialRoomView's own
                // handlePost.
                if (feedPendingAttachment) {
                    await sendPost(client, selectedRoomId, body, undefined, feedPendingAttachment.file);
                    setPostBody("");
                    clearFeedAttachment();
                    onRefresh();
                    return;
                }
                // hasRoom: false - selectedRoomId is just the "post to" dropdown target, not a
                // room this Feed view is actually showing (it aggregates posts from many rooms) -
                // see processSlashCommand's own comment on why /devtools specifically needs to know
                // that.
                const result = await processSlashCommand(client, selectedRoomId, body, false);
                if (!result.handled) {
                    await sendPost(client, selectedRoomId, result.body, result.formattedBody, undefined, result.isEmote);
                    setPostBody("");
                    onRefresh();
                } else if (result.success) {
                    setPostBody("");
                }
                // errored/declined - leave the typed text in place to fix or reconsider.
            } finally {
                setPostBusy(false);
            }
        },
        [client, selectedRoomId, postBody, feedPendingAttachment, clearFeedAttachment, onRefresh, explicitRoomId, profileRoomId],
    );

    // "Scroll to top" button (SocialScrollToTopButton.tsx) - shown once the composer scrolls out
    // of view, mirroring stock's own JumpToBottomButton (shown once you've scrolled away from the
    // live edge of a room). Watched via IntersectionObserver against scrollContainerRef itself as
    // the root, not the page viewport, since the composer scrolls within .social_Content, not with
    // the whole page. Only meaningful when there's actually a composer to scroll past.
    //
    // threadView is in this effect's own deps (even though it's only read to force a re-run, not
    // used in the body) because FeedPane doesn't unmount/remount across the thread <-> feed toggle -
    // it's an early return further down, so this whole component instance (and every hook in it)
    // persists the entire time. The composer's own <form ref={composerRef}> element, however, *does*
    // unmount while a thread is open (that early return replaces this component's whole JSX output)
    // and a brand new one mounts on return - without threadView here, this effect's deps never
    // change across that round-trip, so the observer never re-attaches to the new element and stays
    // stuck watching the old, now-detached one forever after the first thread visit.
    const composerRef = useRef<HTMLFormElement>(null);
    const [composerVisible, setComposerVisible] = useState(true);
    useEffect(() => {
        if (postableRooms.length === 0 || !composerRef.current || !scrollContainerRef.current) return;
        const observer = new IntersectionObserver(
            ([entry]) => setComposerVisible(entry.isIntersecting),
            { root: scrollContainerRef.current },
        );
        observer.observe(composerRef.current);
        return () => observer.disconnect();
    }, [postableRooms.length, scrollContainerRef, threadView]);
    const scrollFeedToTop = useCallback(() => {
        const el = scrollContainerRef.current;
        if (!el) return;
        // A smooth scroll over a very long distance takes a noticeably long time to finish -
        // jump straight there instead once there's more than a couple of screens' worth to cover.
        const behavior = el.scrollTop > SCROLL_TO_TOP_INSTANT_THRESHOLD ? "auto" : "smooth";
        el.scrollTo({ top: 0, behavior });
    }, [scrollContainerRef]);

    // A single file picked/pasted/dropped while this composer is scrolled out of view (same
    // composerVisible tracked above for the scroll-to-top button) would otherwise land silently in
    // this now-offscreen composer's own shelf, giving no feedback that anything happened short of
    // scrolling all the way back up to check - pop up the same PostDialog the sidebar's own Post
    // button opens instead, with the file staged into it directly and targeting whatever room this
    // composer's own "Post to:" picker was already set to.
    const openScrolledAwayPostModal = useCallback(
        (file: File) => {
            Modal.createDialog(PostDialog, { client, initialRoomId: selectedRoomId, initialFile: file }, "social_PostDialog_wrapper");
        },
        [client, selectedRoomId],
    );
    const handleFeedFileSelected = useCallback(
        (file: File) => {
            if (composerVisible) {
                setFeedPendingFile(file);
            } else {
                openScrolledAwayPostModal(file);
            }
        },
        [composerVisible, setFeedPendingFile, openScrolledAwayPostModal],
    );

    // Show thread view if a post was clicked
    if (threadView) {
        return (
            <SocialPostView
                key={threadView.event.getId()}
                event={threadView.event}
                room={threadView.room}
                onBack={() => setThreadView(null)}
                onFocusEvent={(e) => setThreadView({ event: e, room: threadView.room })}
                pillsGeneration={pillsGeneration}
                onViewUser={onViewUser}
                onOpenUserPanel={onOpenUserPanel}
                onNavigateToProfile={onNavigateToProfile}
            />
        );
    }

    return (
        <div className="social_Pane">
            {postableRooms.length > 0 && !composerVisible && (
                <SocialScrollToTopButton onClick={scrollFeedToTop} />
            )}
            <div className="social_Feed_filterRow">
                <button
                    type="button"
                    className="social_ActionBtn social_Feed_filterBtn"
                    onClick={openFilterDialog}
                    aria-label="Feed filters"
                    title="Feed filters"
                >
                    <FilterIcon width="16px" height="16px" />
                    <span>Filter</span>
                </button>
            </div>

            {postableRooms.length > 0 && (
                <form className="social_ComposeBox" onSubmit={handleFeedPost} ref={composerRef}>
                    <div className="social_ComposeBox_inputWrap">
                        {selectedRoomForAutocomplete && (
                            <SlashCommandAutocomplete
                                room={selectedRoomForAutocomplete}
                                query={postBody}
                                selectionStart={feedSelection.start}
                                selectionEnd={feedSelection.end}
                                onConfirm={handleConfirmFeedCompletion}
                                onCompletionsChange={() => {}}
                                controlRef={feedAutocompleteControlRef}
                            />
                        )}
                        <textarea
                            ref={feedTextareaRef}
                            className="social_ComposeBox_input"
                            placeholder="What's on your mind?"
                            value={postBody}
                            onChange={(e) => {
                                setPostBody(e.target.value);
                                updateFeedSelectionFrom(e.target);
                            }}
                            onSelect={(e) => updateFeedSelectionFrom(e.currentTarget)}
                            onClick={(e) => updateFeedSelectionFrom(e.currentTarget)}
                            onKeyUp={(e) => updateFeedSelectionFrom(e.currentTarget)}
                            onPaste={handleComposerPaste}
                            onKeyDown={(e) => {
                                if (feedAutocompleteControlRef.current?.hasCompletions()) {
                                    if (e.key === "ArrowUp") {
                                        e.preventDefault();
                                        feedAutocompleteControlRef.current.moveSelection(-1);
                                        return;
                                    }
                                    if (e.key === "ArrowDown") {
                                        e.preventDefault();
                                        feedAutocompleteControlRef.current.moveSelection(1);
                                        return;
                                    }
                                    if (e.key === "Enter" || e.key === "Tab") {
                                        if (feedAutocompleteControlRef.current.confirmSelection()) {
                                            e.preventDefault();
                                            return;
                                        }
                                    }
                                    if (e.key === "Escape") {
                                        e.preventDefault();
                                        feedAutocompleteControlRef.current.close();
                                        return;
                                    }
                                }
                                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                                    e.preventDefault();
                                    void handleFeedPost();
                                }
                            }}
                            disabled={postBusy}
                            rows={3}
                        />
                    </div>
                    {feedPendingAttachment && (
                        <AttachmentShelf
                            attachment={feedPendingAttachment}
                            uploading={postBusy}
                            onRemove={clearFeedAttachment}
                        />
                    )}
                    <div className="social_ComposeBox_recorderSlot" ref={setRecorderSlot} />
                    <div className="social_ComposeBox_footer">
                        <div className="social_ComposeBox_roomPicker">
                            <span className="social_ComposeBox_label">Post to:</span>
                            <RoomPickerButton
                                client={client}
                                value={selectedRoomId}
                                myProfileRoomId={myProfileRoom?.roomId}
                                onChange={setExplicitRoomId}
                            />
                        </div>
                        {selectedRoomId && client.getRoom(selectedRoomId) && !postBusy && (
                            <PostComposerButtons
                                room={client.getRoom(selectedRoomId)!}
                                addEmoji={(emoji) => {
                                    setPostBody((body) => body + emoji);
                                    return true;
                                }}
                                canSubmit={
                                    (!!postBody.trim() || !!feedPendingAttachment) &&
                                    (!!explicitRoomId || profileRoomId !== undefined)
                                }
                                onSubmit={() => void handleFeedPost()}
                                sendButtonTitle="Post"
                                recorderSlot={recorderSlot}
                                onFileSelected={handleFeedFileSelected}
                            />
                        )}
                    </div>
                </form>
            )}

            {posts.length === 0 ? (
                <div className="social_ContentEmpty">
                    <p>No posts yet. Follow some profiles or groups to see their posts here.</p>
                </div>
            ) : (
                <div className="social_Feed">
                    {visiblePosts.map(({ event, room, myLikeEventId, myRepostEventId, replyCount }) => (
                        <SocialEventTile
                            key={event.getId()}
                            event={event}
                            room={room}
                            isLiked={!!myLikeEventId}
                            isReposted={!!myRepostEventId}
                            replyCount={replyCount}
                            hideRoomName={isProfilePostByOwner(event, room)}
                            pillsGeneration={pillsGeneration}
                            onRoomClick={onViewRoom}
                            onViewUser={onViewUser}
                            onOpenUserPanel={onOpenUserPanel}
                            onNavigateToProfile={onNavigateToProfile}
                            onViewThread={handleViewThread}
                            onLike={() => handleLike(room.roomId, event.getId()!, myLikeEventId)}
                            onReply={(body, file) => handleReply(room.roomId, event.getId()!, body, file)}
                        />
                    ))}
                    {/* Sentinel: scrolling this into view reveals more posts (from memory, or by
                        fetching more history once memory is exhausted) — mirrors Element's own
                        "load more on scroll" pagination in normal room timelines. */}
                    {(hasMoreAlreadyLoaded || hasMoreHistory) && (
                        <div ref={sentinelRef} className="social_Feed_loadMore">
                            {loadingMoreHistory && <Spinner />}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Groups pane
// ---------------------------------------------------------------------------

function GroupsPane({
    rooms,
    client,
    onViewRoom,
    onRefresh,
}: {
    rooms: Room[];
    client: MatrixClient;
    onViewRoom: (roomId: string) => void;
    onRefresh: () => void;
}): JSX.Element {
    const groups = useMemo(
        () => rooms.filter((r) => isGroupRoom(r) && r.getMyMembership() === KnownMembership.Join),
        [rooms],
    );

    const [query, setQuery] = useState("");
    const filteredGroups = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return groups;
        return groups.filter((r) => r.name.toLowerCase().includes(q));
    }, [groups, query]);

    const handleCreate = useCallback(async () => {
        const roomId = await openCreateGroupDialog(client);
        if (roomId) {
            onRefresh();
            onViewRoom(roomId);
        }
    }, [client, onRefresh, onViewRoom]);

    return (
        <div className="social_Pane">
            <div className="social_Pane_titleRow">
                <button className="social_ActionBtn social_ActionBtn--primary" onClick={handleCreate}>
                    + New Group
                </button>
                <input
                    type="text"
                    className="social_GroupsSearch"
                    placeholder="Search groups…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
            </div>

            {groups.length === 0 ? (
                <div className="social_ContentEmpty">
                    <p>You are not in any groups yet. Create one above or search for groups to join.</p>
                </div>
            ) : filteredGroups.length === 0 ? (
                <div className="social_ContentEmpty">
                    <p>No groups match your search.</p>
                </div>
            ) : (
                <div className="social_GroupGrid">
                    {filteredGroups.map((room) => (
                        <GroupTile key={room.roomId} room={room} client={client} onView={onViewRoom} />
                    ))}
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Profile pane
// ---------------------------------------------------------------------------

function ProfilePane({
    rooms,
    profileRoomId,
    client,
    pillsGeneration,
    onViewRoom,
    onViewUser,
    onOpenUserPanel,
    onOpenRoomPanel,
    onRefresh,
    scrollContainerRef,
    closeThreadToken,
}: {
    rooms: Room[];
    profileRoomId: string | null | undefined;
    client: MatrixClient;
    pillsGeneration: number;
    onViewRoom: (roomId: string) => void;
    onViewUser: (userId: string) => void;
    onOpenUserPanel: (userId: string, room: Room) => void;
    onOpenRoomPanel: (room: Room, phase: RightPanelPhases, state?: Record<string, unknown>) => void;
    onRefresh: () => void;
    scrollContainerRef: React.RefObject<HTMLElement | null>;
    /** Forwarded to SocialRoomView - see its own doc on why this is needed even when profileRoom's
     *  own `key` doesn't change (clicking your own name while already viewing your own profile). */
    closeThreadToken: number;
}): JSX.Element {
    // The profile room is always whatever room org.matrix.msc4501.social.profile_room_id names on
    // the user's own profile (see useProfileRoomLink) - no local guessing while it's still
    // resolving. A user can genuinely have more than one room that locally looks like "their"
    // profile room (own creator, or verified via profile_user_id), with no reliable way to tell
    // which one the real link will resolve to - guessing wrong is worse than a brief wait, so this
    // shows a loading state below instead of a guess.
    const profileRoom = useMemo(() => {
        if (!profileRoomId) return null; // still loading (undefined) or confirmed unlinked (null)
        return rooms.find((r) => r.roomId === profileRoomId) ?? null;
    }, [rooms, profileRoomId]);

    // When the profile already exists go straight to the room view.
    if (profileRoom) {
        return (
            <SocialRoomView
                key={profileRoom.roomId}
                room={profileRoom}
                pillsGeneration={pillsGeneration}
                onViewUser={onViewUser}
                onOpenUserPanel={onOpenUserPanel}
                onOpenRoomPanel={onOpenRoomPanel}
                onRoomClick={onViewRoom}
                scrollContainerRef={scrollContainerRef}
                closeThreadToken={closeThreadToken}
            />
        );
    }

    // profileRoomId still unresolved - show a neutral loading state rather than falling through to
    // the Create Profile prompt below, which would otherwise flash "you have no profile" for a
    // real profile owner while the real link is still resolving.
    if (profileRoomId === undefined) {
        return (
            <div className="social_Pane">
                <Spinner />
            </div>
        );
    }

    const handleCreateProfile = async (): Promise<void> => {
        const roomId = await openCreateProfileDialog(client);
        if (roomId) {
            onRefresh();
            onViewRoom(roomId);
        }
    };

    return (
        <div className="social_Pane">
            <h2 className="social_Pane_header">Profile</h2>
            <div className="social_CreateProfilePrompt">
                <p className="social_CreateProfilePrompt_text">
                    You don't have a profile yet. Create one to start posting.
                </p>
                <button
                    className="social_ActionBtn social_ActionBtn--primary social_CreateProfilePrompt_button"
                    onClick={() => void handleCreateProfile()}
                >
                    Create Profile
                </button>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Group room card (with optional Edit button)
// ---------------------------------------------------------------------------

function GroupTile({
    room,
    client,
    onView,
}: {
    room: Room;
    client: MatrixClient;
    onView: (id: string) => void;
}): JSX.Element {
    const topic: string =
        room.currentState.getStateEvents("m.room.topic", "")?.getContent().topic ?? "";
    const bannerMxc: string | undefined = room.currentState
        .getStateEvents(ROOM_BANNER_EVENT_TYPE, "")
        ?.getContent()?.url;
    const bannerHttpUrl = bannerMxc ? client.mxcUrlToHttp(bannerMxc) : null;

    return (
        <button type="button" className="social_GroupTile" onClick={() => onView(room.roomId)}>
            <div className="social_GroupTile_banner">
                {bannerHttpUrl && <img src={bannerHttpUrl} alt="" aria-hidden />}
            </div>
            <div className="social_GroupTile_avatarWrap">
                <RoomAvatar room={room} size="72px" />
            </div>
            <div className="social_GroupTile_info">
                <div className="social_GroupTile_name">{room.name}</div>
                {topic && <div className="social_GroupTile_topic">{topic}</div>}
                <div className="social_GroupTile_meta">{room.getJoinedMemberCount()} members</div>
            </div>
        </button>
    );
}

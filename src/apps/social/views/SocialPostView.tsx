/*
 * Social Overlay — SocialPostView
 *
 * Thread view, Soapbox/poa.st-style connected threading (see chat history for the design spec this
 * was built from — https://poa.st/@graf/posts/AVdMiKH4fFLnbhx28G was the reference example).
 *
 * A post opened here ("the focused post") is not necessarily the thread's true root — Haven's own
 * m.thread relation (see sendComment in social-actions.ts) always points at the *immediate* parent,
 * not the root, so a reply-of-a-reply's own event_id chain has to be walked all the way up to find
 * it. What's shown:
 *
 * - The thread root, always at the very top, same prominent styling whether or not it's also the
 *   focused post.
 * - Every ancestor between the root and the focused post (when the focused post isn't the root),
 *   connected top-to-bottom by a vertical line, ending at the focused post.
 * - The focused post itself — same prominent styling as the root, so there's no visual difference
 *   suggesting it *is* the root when it isn't; scrolling up still reveals the real ancestor chain.
 * - Below it, every reply at every depth, flattened into one plain list, oldest first — no nested
 *   indentation or connecting line between them, since each reply's own "reply to X's post" header
 *   line (RepliedToIndicator) already shows who it's replying to. Clicking a reply re-focuses the
 *   thread view on it instead of expanding it in place.
 */

import React, {
    type JSX,
    useCallback,
    useEffect,
    useMemo,
    useState,
} from "react";
import { type MatrixEvent, type Room, RelationType, EventType } from "matrix-js-sdk/src/matrix";

import { useMatrixClientContext } from "../../../../element-web/apps/web/src/contexts/MatrixClientContext";
import { SocialEventTile } from "../components/SocialEventTile";
import { sendLike, undoLike, sendComment, sendPostReadReceipt, type PostFileAttachment } from "../utils/social-actions";
import { getProfileOwnerUserId } from "../utils/room-classifier";
import { immediateParentId, threadRootId } from "../utils/thread-relations";
import { getMyReactions } from "../../../../element-web/apps/web/src/components/views/rooms/EventTile/ReactionsRowAdapter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ThreadNode {
    event: MatrixEvent;
    myLikeEventId: string | undefined;
    myRepostEventId: string | undefined;
    /** Count of direct replies to this node (shown on its own Reply button). */
    replyCount: number;
}

// ---------------------------------------------------------------------------
// Thread-structure helpers
// ---------------------------------------------------------------------------
// immediateParentId / threadRootId now live in utils/thread-relations.ts, shared with
// SocialHomeView/SocialRoomView so every view resolves a reply's parent/root the same way.

/**
 * Walks up the immediate-parent chain from `event` to the true thread root, root-first, not
 * including `event` itself. Stops (rather than throwing) on a cycle or a parent that's missing
 * after a fetch attempt — same graceful-degradation spirit as the rest of this app.
 */
async function findThreadAncestors(
    client: ReturnType<typeof useMatrixClientContext>,
    room: Room,
    event: MatrixEvent,
): Promise<MatrixEvent[]> {
    const ancestors: MatrixEvent[] = [];
    let current = event;
    const seen = new Set<string>([event.getId()!]);
    for (;;) {
        const parentId = immediateParentId(current);
        if (!parentId || seen.has(parentId)) break;
        let parent = room.findEventById(parentId);
        if (!parent) {
            try {
                parent = new (await import("matrix-js-sdk/src/matrix")).MatrixEvent(
                    await client.fetchRoomEvent(room.roomId, parentId),
                );
            } catch {
                // The immediate-parent lookup (preferring m.in_reply_to) didn't resolve to
                // anything real - can happen when a bridge's own m.in_reply_to names the *other
                // side's* own parent message (e.g. the original fediverse toot being replied to)
                // rather than anything that was ever mirrored into this room as Matrix content.
                // Falling back to the thread's own root (always spec-guaranteed correct, regardless
                // of what m.in_reply_to says) means the walk still reaches a real ancestor - the
                // true root specifically - instead of stopping short and leaving nothing above the
                // focused post at all, even if some intermediate hop couldn't be resolved.
                const rootId = threadRootId(current);
                if (rootId && !seen.has(rootId)) {
                    let root = room.findEventById(rootId) ?? null;
                    if (!root) {
                        try {
                            root = new (await import("matrix-js-sdk/src/matrix")).MatrixEvent(
                                await client.fetchRoomEvent(room.roomId, rootId),
                            );
                        } catch {
                            root = null;
                        }
                    }
                    if (root) ancestors.push(root);
                }
                break;
            }
        }
        ancestors.push(parent);
        seen.add(parentId);
        current = parent;
    }
    return ancestors.reverse();
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface Props {
    event: MatrixEvent;
    room: Room;
    onBack: () => void;
    /** Forwarded to SocialEventTile — see SocialEventTile's Props doc. */
    pillsGeneration?: number;
    /** Forwarded to SocialEventTile — navigates to the sender's Social profile. */
    onViewUser?: (userId: string) => void;
    /** Forwarded to SocialEventTile — opens the stock member-info right panel for the sender. */
    onOpenUserPanel?: (userId: string, room: Room) => void;
    /** Forwarded to SocialEventTile — see its Props doc. */
    onNavigateToProfile?: () => void;
    /** Forwarded to SocialEventTile — see its Props doc. */
    onRoomClick?: (roomId: string) => void;
    /** Re-focuses this same thread view on a different event in the same room — used for clicking
     *  an ancestor tile, or any reply tile's own card body (per SocialEventTile's own
     *  handleArticleClick), to go deeper/back up the chain without leaving the thread view. Thread
     *  relations never cross rooms, so every tile rendered here is always in `room`. */
    onFocusEvent?: (event: MatrixEvent) => void;
}

export function SocialPostView({
    event,
    room,
    onBack,
    pillsGeneration,
    onViewUser,
    onOpenUserPanel,
    onNavigateToProfile,
    onRoomClick,
    onFocusEvent,
}: Props): JSX.Element {
    const client = useMatrixClientContext();
    const myUserId = client.getUserId() ?? "";
    const focusedEventId = event.getId()!;

    // Use a tick counter so useMemo re-reads room/thread state on any update.
    const [tick, setTick] = useState(0);
    const refresh = useCallback(() => setTick((t) => t + 1), []);

    useEffect(() => {
        room.on("Room.timeline" as any, refresh);
        room.on("Room.localEchoUpdated" as any, refresh);
        return () => {
            room.off("Room.timeline" as any, refresh);
            room.off("Room.localEchoUpdated" as any, refresh);
        };
    }, [room, refresh]);

    // Opening a post (arriving here as the focused post, whether via a click or a matrix.to link)
    // counts as reading it, even if it was never scrolled through in a room timeline.
    useEffect(() => {
        void sendPostReadReceipt(client, room.roomId, focusedEventId);
    }, [client, room, focusedEventId]);

    // Ancestor chain (root-first, excluding the focused post) — resolved async since a distant
    // ancestor may need fetching (see findThreadAncestors).
    const [ancestors, setAncestors] = useState<MatrixEvent[]>([]);
    useEffect(() => {
        let cancelled = false;
        setAncestors([]);
        void findThreadAncestors(client, room, event).then((chain) => {
            if (!cancelled) setAncestors(chain);
        });
        return () => {
            cancelled = true;
        };
    }, [client, room, event]);

    // The whole thread's true root id (ancestors are root-first - see findThreadAncestors), i.e.
    // the focused post itself when it has no ancestors at all.
    const rootEventId = ancestors.length > 0 ? ancestors[0].getId()! : focusedEventId;

    // Every event the SERVER knows declares an m.thread relation targeting the root, fetched
    // directly via the /relations API rather than relying on whatever's already synced locally.
    // Needed because a reply that gets edited almost immediately can end up with only its EDIT
    // event ever separately synced into the room's local timeline/thread model - the original
    // send itself (which is what actually carries the real m.thread/m.in_reply_to relation data)
    // may never be locally cached at all, even though it's a perfectly real, permanently existing
    // event server-side. Without this, such a reply (and anything replying to IT in turn) would be
    // silently invisible no matter how thoroughly the local room/thread events are scanned.
    const [rootRelationEvents, setRootRelationEvents] = useState<MatrixEvent[]>([]);
    useEffect(() => {
        let cancelled = false;
        setRootRelationEvents([]);
        client
            .relations(room.roomId, rootEventId, RelationType.Thread)
            .then(({ events }) => {
                if (!cancelled) setRootRelationEvents(events);
            })
            .catch(() => {
                // Best-effort - local-only data (already covered by getDirectReplies' other pools)
                // is still better than nothing if the server doesn't support/allow this query.
            });
        return () => {
            cancelled = true;
        };
    }, [client, room, rootEventId]);

    // Ensures a Thread object exists for `parent` before reading its children — without this,
    // matrix-js-sdk drops thread-relation events with nowhere local to route them into instead of
    // ever surfacing them (see sendComment's own identical use of this for the same reason).
    // Idempotent (Room.createThread returns the existing Thread if one's already there).
    const ensureThread = useCallback(
        (parent: MatrixEvent): void => {
            const id = parent.getId();
            if (id && !room.getThread(id)) {
                room.createThread(id, parent, [], false);
            }
        },
        [room],
    );

    // Direct (one level down) replies to `parent`, oldest first, with this user's own 👍 state.
    const getDirectReplies = useCallback(
        (parent: MatrixEvent): ThreadNode[] => {
            ensureThread(parent);
            const parentId = parent.getId()!;
            const thread = room.getThread(parentId);
            const threadEvts: MatrixEvent[] = thread ? thread.events : [];

            // Some replies (e.g. from external bridges/clients following the strict Matrix spec
            // convention) always point their own m.thread relation at the thread's TRUE root
            // rather than their own immediate parent, unlike Haven's own sendComment (see this
            // file's header comment) - so a non-root parent's own Thread object can be
            // structurally empty even though it has real direct replies, because those replies
            // actually live under the root's own Thread instead. Merging the root's own thread
            // events in here too means direct replies are found regardless of which convention
            // produced them.
            let rootThreadEvts: MatrixEvent[] = [];
            if (parentId !== rootEventId) {
                const rootEvent = ancestors[0] ?? room.findEventById(rootEventId);
                if (rootEvent) ensureThread(rootEvent);
                const rootThread = room.getThread(rootEventId);
                rootThreadEvts = rootThread ? rootThread.events : [];
            }

            const live: MatrixEvent[] = room.getLiveTimeline().getEvents();
            const pending: MatrixEvent[] = (room as any).getPendingEvents?.() ?? [];

            const seen = new Set<string>();
            const all: MatrixEvent[] = [];
            for (const e of [...live, ...pending, ...threadEvts, ...rootThreadEvts, ...rootRelationEvents]) {
                const id = e.getId();
                if (id && !seen.has(id)) {
                    seen.add(id);
                    all.push(e);
                }
            }

            // Read my own like/repost state per-reply via the room's own relations aggregation
            // (room.relations.getChildEventsForEvent), not by scanning `all` for annotations - `all`
            // is built from live/pending/thread events, which reliably carries real reply MESSAGES
            // but not necessarily every individual reaction event pointed at them (Synapse can
            // aggregate/report a reaction's *count* without that specific reaction event ever
            // landing in a synced timeline/thread window) - see SocialHomeView's aggregatePosts for
            // the same fix and fuller explanation.
            return all
                .filter((e) => immediateParentId(e) === parentId)
                .sort((a, b) => a.getTs() - b.getTs())
                .map((e) => {
                    const eid = e.getId()!;
                    const reactions = room.relations.getChildEventsForEvent(eid, RelationType.Annotation, EventType.Reaction);
                    const myReactions = getMyReactions(reactions, myUserId) ?? [];
                    return {
                        event: e,
                        myLikeEventId: myReactions.find((r) => r.getContent()?.["m.relates_to"]?.key === "👍")?.getId(),
                        myRepostEventId: myReactions.find((r) => r.getContent()?.["m.relates_to"]?.key === "🔁")?.getId(),
                        replyCount: 0,
                    };
                });
        },
        [room, myUserId, ensureThread, rootEventId, ancestors, rootRelationEvents],
    );

    // The reply-count badge shown on `node`'s own card: for the whole view's true root (per
    // rootEventId above, established by walking ancestors - never just "does node happen to have a
    // matrix-js-sdk Thread object", since ensureThread/getDirectReplies create a synthetic, empty
    // Thread for WHATEVER node they're asked about as routing plumbing, root or not - checking
    // thread existence alone would wrongly treat every node as "a root" the moment it's been
    // queried once), this is the server-authoritative total thread size (matrix-js-sdk's own
    // Thread.length, the same number stock Element's own thread summary badge shows, and the same
    // number Feed/Room view show for this same event - see SocialHomeView's aggregatePosts) - not
    // just direct replies. Every other node (ancestors below the root, 1st/2nd-level replies) shows
    // direct-reply count only, per this file's own nested-reply design.
    const replyCountForNode = useCallback(
        (node: MatrixEvent): number => {
            if (node.getId() === rootEventId) {
                const thread = room.getThread(rootEventId);
                if (thread) return thread.length;
            }
            return getDirectReplies(node).length;
        },
        [room, getDirectReplies, rootEventId],
    );

    // The focused post's own like/repost state + total direct-reply count (for its Reply button).
    const { myLikeEventId, myRepostEventId, replyCount } = useMemo(() => {
        const count = replyCountForNode(event);
        // Read via the room's own relations aggregation (room.relations.getChildEventsForEvent),
        // not by scanning live/pending/thread events for annotations pointing at focusedEventId -
        // see getDirectReplies' own comment (same fix) for why that scan is unreliable for
        // reactions specifically.
        const reactions = room.relations.getChildEventsForEvent(focusedEventId, RelationType.Annotation, EventType.Reaction);
        const myReactions = getMyReactions(reactions, myUserId) ?? [];
        const liked = myReactions.find((r) => r.getContent()?.["m.relates_to"]?.key === "👍")?.getId();
        const reposted = myReactions.find((r) => r.getContent()?.["m.relates_to"]?.key === "🔁")?.getId();
        return { myLikeEventId: liked, myRepostEventId: reposted, replyCount: count };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tick, replyCountForNode, event, room, focusedEventId, myUserId]);

    // Every reply at every depth below the focused post, flattened into one plain list, oldest
    // first - no nested indentation, per this file's own header comment. Each node still carries
    // its own direct-reply count (its own Reply button badge), just not a separately-rendered
    // nested child - the "reply to X's post" line on the reply itself already shows the chain.
    const allReplies: ThreadNode[] = useMemo(() => {
        const seen = new Set<string>([focusedEventId]);
        const result: ThreadNode[] = [];
        const queue: MatrixEvent[] = [event];
        while (queue.length > 0) {
            const parent = queue.shift()!;
            for (const node of getDirectReplies(parent)) {
                const id = node.event.getId()!;
                if (seen.has(id)) continue;
                seen.add(id);
                result.push({ ...node, replyCount: getDirectReplies(node.event).length });
                queue.push(node.event);
            }
        }
        return result.sort((a, b) => a.event.getTs() - b.event.getTs());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tick, getDirectReplies, event, focusedEventId]);

    const handleLikeFor = useCallback(
        async (targetEventId: string, targetLikeEventId: string | undefined) => {
            if (targetLikeEventId) {
                await undoLike(client, room.roomId, targetLikeEventId);
            } else {
                await sendLike(client, room.roomId, targetEventId);
            }
        },
        [client, room.roomId],
    );

    // Every reply here is flat against its own direct parent (see file header) — the parent to
    // reply to is always whichever tile's own Reply button was clicked, forwarded through
    // SocialEventTile's onReply prop, not always the focused post itself.
    const handleReplyTo = useCallback(
        async (parentEventId: string, body: string, file?: PostFileAttachment) => {
            await sendComment(client, room.roomId, body, parentEventId, file);
            refresh();
        },
        [client, room.roomId, refresh],
    );

    const hideRoomNameFor = useCallback(
        (e: MatrixEvent): boolean => {
            const owner = getProfileOwnerUserId(room);
            return !!owner && e.getSender() === owner;
        },
        [room],
    );

    // Every tile shown here (ancestors, focused post, 1st/2nd-level replies) is always in `room` -
    // thread relations never cross rooms - so any click SocialEventTile routes through onViewThread
    // (its own card body, or a same-room quoted/reposted card inside it) re-focuses this same
    // thread view via onFocusEvent instead of trying to navigate away.
    const handleViewThread = useCallback(
        (target: MatrixEvent, targetRoom: Room) => {
            if (targetRoom === room) onFocusEvent?.(target);
        },
        [room, onFocusEvent],
    );

    const tileProps = {
        pillsGeneration,
        onViewUser,
        onOpenUserPanel,
        onNavigateToProfile,
        onRoomClick,
        onViewThread: handleViewThread,
    };

    return (
        <div className="social_PostView">
            <div className="social_PostView_backBar">
                <button className="social_BackBtn" onClick={onBack}>
                    ← Back
                </button>
            </div>

            {/* Ancestor chain + focused post — connected by one continuous line running behind
                every tile in this group (see .social_PostView_thread's CSS), ending at the focused
                post. Only rendered as a connected group when there's at least one ancestor. */}
            <div className={`social_PostView_thread${ancestors.length > 0 ? " social_PostView_thread--connected" : ""}`}>
                {ancestors.map((ancestor, i) => (
                    <div className="social_PostView_threadItem" key={ancestor.getId()}>
                        <SocialEventTile
                            event={ancestor}
                            room={room}
                            isLiked={false}
                            isReposted={false}
                            replyCount={replyCountForNode(ancestor)}
                            hideRoomName={hideRoomNameFor(ancestor)}
                            // Thread root: the oldest ancestor (ancestors are root-first - see
                            // findThreadAncestors), i.e. i === 0.
                            forceFullTimestamp={i === 0}
                            {...tileProps}
                        />
                    </div>
                ))}
                <div className="social_PostView_threadItem social_PostView_mainPost">
                    <SocialEventTile
                        event={event}
                        room={room}
                        isLiked={!!myLikeEventId}
                        isReposted={!!myRepostEventId}
                        replyCount={replyCount}
                        hideRoomName={hideRoomNameFor(event)}
                        onLike={() => handleLikeFor(focusedEventId, myLikeEventId)}
                        onReply={(body, file) => handleReplyTo(focusedEventId, body, file)}
                        // Focused post: always shown in full - and doubles as the thread root's own
                        // full timestamp when there are no ancestors at all.
                        forceFullTimestamp
                        {...tileProps}
                    />
                </div>
            </div>

            {/* Every reply at every depth, flattened - no nesting/indentation between them, see
                this file's own header comment. */}
            <div className="social_PostView_replies">
                <h3 className="social_PostView_repliesHeader">
                    {replyCount} {replyCount === 1 ? "reply" : "replies"}
                </h3>
                {allReplies.length === 0 ? (
                    <div className="social_ContentEmpty">
                        <p>No replies yet. Be the first!</p>
                    </div>
                ) : (
                    allReplies.map((node) => (
                        <SocialEventTile
                            key={node.event.getId()}
                            event={node.event}
                            room={room}
                            isLiked={!!node.myLikeEventId}
                            isReposted={!!node.myRepostEventId}
                            replyCount={node.replyCount}
                            hideRoomName={true}
                            onReply={(body, file) => handleReplyTo(node.event.getId()!, body, file)}
                            onLike={() => handleLikeFor(node.event.getId()!, node.myLikeEventId)}
                            {...tileProps}
                        />
                    ))
                )}
            </div>
        </div>
    );
}

/*
 * Social Overlay — thread relation helpers
 *
 * Shared by SocialHomeView, SocialRoomView, and SocialPostView so every view computes "who is
 * this event's immediate parent" and "how many direct replies does this event have" the exact
 * same way — otherwise the same post can end up showing a different reply count depending on
 * which view happened to compute it.
 */

import { type MatrixClient, type MatrixEvent, type Room, RelationType } from "matrix-js-sdk/src/matrix";

/** The immediate parent's event id. Prefers m.in_reply_to — its whole purpose, universally across
 *  Matrix clients/bridges, is naming the exact message being replied to, unlike m.thread's own
 *  event_id, which Haven's sendComment sets to the immediate parent but which real Matrix clients
 *  (and content mirrored in by a bridge, e.g. the ActivityPub bridge for poa.st/Soapbox replies)
 *  set to the thread's true ROOT instead, per the actual Matrix spec convention. Reading m.thread's
 *  event_id for that content would misread a deep reply as being one level deep. Falls back to it
 *  only when no m.in_reply_to is present at all.
 *
 *  Reads getWireContent(), not getContent() — once an event has been edited, getContent()
 *  substitutes in the edit's m.new_content, which never re-declares the original m.relates_to. */
export function immediateParentId(e: MatrixEvent): string | undefined {
    const rel = e.getWireContent()?.["m.relates_to"];
    return rel?.["m.in_reply_to"]?.event_id ?? (rel?.rel_type === "m.thread" ? rel.event_id : undefined);
}

/** The thread's true root event id, per m.relates_to.event_id's own spec-guaranteed meaning for
 *  rel_type m.thread — unlike immediateParentId's own m.in_reply_to preference, this is reliable
 *  regardless of which convention (Haven's own "immediate parent" vs a standard client/bridge's own
 *  "true root") produced the event, since it's the *same* field either way for the root specifically
 *  - only what m.in_reply_to points at varies. */
export function threadRootId(e: MatrixEvent): string | undefined {
    const rel = e.getWireContent()?.["m.relates_to"];
    return rel?.rel_type === "m.thread" ? rel.event_id : undefined;
}

/**
 * Direct-reply count for `parentId`, counting every event across the given candidate pools whose
 * immediate parent (per immediateParentId above) is exactly `parentId` — one level down only, not
 * transitively. Callers should pass every pool that could plausibly hold a direct reply: the
 * parent's own matrix-js-sdk Thread (real for Haven-native replies, which point their own m.thread
 * relation at their immediate parent - see sendComment in social-actions.ts), the thread ROOT's own
 * Thread (real for spec-compliant replies from external clients/bridges, which always point
 * m.thread at the true root instead, so a non-root parent's own Thread can be structurally empty
 * even when it has real direct replies living under the root's Thread instead), and the room's live
 * timeline / pending events as a catch-all.
 */
export function countDirectReplies(pools: MatrixEvent[][], parentId: string): number {
    const seen = new Set<string>();
    let count = 0;
    for (const pool of pools) {
        for (const e of pool) {
            const id = e.getId();
            if (!id || seen.has(id)) continue;
            seen.add(id);
            if (immediateParentId(e) === parentId) count++;
        }
    }
    return count;
}

/**
 * Precomputes every event's direct-reply count across `pools` in a single O(n) pass, keyed by
 * parent event id. Callers that need replyCountFor for many events sharing the same pools (e.g.
 * aggregating a whole room's worth of posts) should build this once up front and pass it to
 * replyCountFor's `directReplyCounts` argument, instead of letting each call rescan `pools` from
 * scratch via countDirectReplies — doing that once per event turns an O(events) computation into
 * O(events^2) overall, which is exactly what made the Feed grind to a halt once backfill had pulled
 * enough history into a room's event pool for that quadratic blowup to actually matter.
 */
export function buildDirectReplyCounts(pools: MatrixEvent[][]): Map<string, number> {
    const counts = new Map<string, number>();
    const seen = new Set<string>();
    for (const pool of pools) {
        for (const e of pool) {
            const id = e.getId();
            if (!id || seen.has(id)) continue;
            seen.add(id);
            const parentId = immediateParentId(e);
            if (parentId) counts.set(parentId, (counts.get(parentId) ?? 0) + 1);
        }
    }
    return counts;
}

/**
 * The reply-count to show on `event`'s own card: when matrix-js-sdk recognizes `event` as an actual
 * thread root, this is the server-authoritative total thread size (matrix-js-sdk's own
 * `Thread.length`, the same number stock Element's own thread summary badge shows) — total, not
 * just direct replies, matching how a "thread" is understood when previewed as a single card
 * (Feed/Room view) rather than opened into its own nested reply tree. Otherwise (event isn't a
 * recognized root — e.g. a non-root reply surfaced as its own feed entry), falls back to counting
 * direct replies only, since Social has no broader "total size" concept for a non-root node.
 *
 * Pass `directReplyCounts` (see buildDirectReplyCounts above) when calling this for many events
 * against the same pools — omitting it falls back to a fresh countDirectReplies scan per call,
 * correct but O(n) per event rather than O(1).
 */
export function replyCountFor(
    event: MatrixEvent,
    room: Room,
    pools: MatrixEvent[][],
    directReplyCounts?: Map<string, number>,
): number {
    const id = event.getId();
    if (!id) return 0;
    // getServerAggregatedRelation(), not just "does room.getThread(id) exist" - SocialPostView's own
    // ensureThread creates a synthetic, empty local Thread object for WHATEVER node it's asked
    // about (root or not), as routing plumbing for matrix-js-sdk's handleRemoteEcho - and Room
    // objects are singletons per room, so a non-root reply visited there once leaves that synthetic
    // Thread behind for the rest of the session. The server's own bundled aggregation is the only
    // signal that can't be polluted by local client-side thread creation.
    if (event.getServerAggregatedRelation(RelationType.Thread)) {
        const thread = room.getThread(id);
        if (thread) return thread.length;
    }
    return directReplyCounts ? (directReplyCounts.get(id) ?? 0) : countDirectReplies(pools, id);
}

/**
 * Every event in `room` worth considering as a potential post/reply: the main live timeline, plus
 * every thread's own timeline. Thread replies (m.relates_to.rel_type === "m.thread") live entirely
 * in that thread's own timeline (Thread.timeline), not the room's main live timeline —
 * matrix-js-sdk splits them out, so reading only getLiveTimeline() would never surface a reply.
 * De-duped since a thread's own timeline includes its root event too, which the main live timeline
 * already has.
 */
export function gatherRoomEvents(room: Room): MatrixEvent[] {
    const seen = new Set<string>();
    const events: MatrixEvent[] = [];
    for (const e of room.getLiveTimeline().getEvents()) {
        const id = e.getId();
        if (id) {
            if (seen.has(id)) continue;
            seen.add(id);
        }
        events.push(e);
    }
    for (const thread of room.getThreads()) {
        for (const e of thread.events) {
            const id = e.getId();
            if (id) {
                if (seen.has(id)) continue;
                seen.add(id);
            }
            events.push(e);
        }
    }
    return events;
}

/**
 * Walks the m.in_reply_to chain from `eventId` up to its own true thread root - the first ancestor
 * with no further parent of its own. sendComment (social-actions.ts) needs this rather than just
 * using `eventId` directly: the Matrix spec requires every reply in a thread to point rel_type:
 * m.thread's own event_id at the *same*, single, flat root regardless of reply depth - Synapse
 * rejects "starting a thread" rooted at an event that itself already carries a relation (real
 * failure mode this fixed: replying to a reply 400'd with "Cannot start threads from an event with
 * a relation" once Haven briefly used the immediate parent's own id here instead). m.in_reply_to is
 * what's walked (not rel_type: m.thread's own event_id) because that's reliably "who does this
 * event actually reply to" regardless of which convention (Haven's own vs. a spec-compliant
 * client's/bridge's) produced any given hop - see immediateParentId's own comment.
 *
 * Falls back to `eventId` itself (treats it as its own root) on a cycle or a parent that can't be
 * found even after a fetch attempt - same graceful-degradation spirit as findThreadAncestors in
 * SocialPostView.tsx, which this mirrors, just returning only the final id instead of the whole
 * chain.
 */
export async function resolveThreadRootId(client: MatrixClient, room: Room, eventId: string): Promise<string> {
    let currentId = eventId;
    const seen = new Set<string>([eventId]);
    for (;;) {
        let current: MatrixEvent | undefined = room.findEventById(currentId);
        if (!current) {
            try {
                const { MatrixEvent } = await import("matrix-js-sdk/src/matrix");
                current = new MatrixEvent(await client.fetchRoomEvent(room.roomId, currentId));
            } catch {
                return currentId;
            }
        }
        const parentId = immediateParentId(current);
        if (!parentId || seen.has(parentId)) return currentId;
        seen.add(parentId);
        currentId = parentId;
    }
}

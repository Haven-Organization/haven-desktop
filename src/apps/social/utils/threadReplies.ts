/*
 * Social Overlay - threadReplies
 *
 * Fetches every event in a thread from the server (the root's m.thread relations), so a post's
 * direct replies can be found and counted even when the thread was never synced locally.
 *
 * Needed because the reply a post's other replies hang off can easily sit outside whatever got
 * synced. A thread of bridged fediverse replies is usually one long chain: only the oldest event
 * replies to the root directly, and every later one replies to the event before it. Synapse's
 * /relations also returns just 5 events when no limit is given, newest first, so a single
 * unpaginated request missed that oldest event entirely. Confirmed live: a post with 8 thread
 * events showed no replies at all, and a room the account has left never fills the root's local
 * Thread timeline either, so nothing else surfaced it.
 */

import { useEffect, useState } from "react";
import { Direction, type MatrixClient, type MatrixEvent, RelationType, type Room } from "matrix-js-sdk/src/matrix";

import { countDirectReplies } from "./thread-relations";

/** Stops an extremely long thread from paging forever. */
const MAX_PAGES = 10;
const PAGE_SIZE = 100;

/** One fetch per thread per session - `${roomId}|${rootId}` to its in-flight or settled fetch. */
const loads = new Map<string, Promise<MatrixEvent[]>>();
/** The settled results of `loads`, for synchronous reads during render. */
const loaded = new Map<string, MatrixEvent[]>();

/** Every event already fetched for the thread rooted at `rootId`, or undefined if not loaded yet. */
export function getLoadedThreadReplies(roomId: string, rootId: string): MatrixEvent[] | undefined {
    return loaded.get(`${roomId}|${rootId}`);
}

/**
 * Loads every event in the thread rooted at `rootId` from the server, once per session. Safe to
 * call repeatedly and from many tiles at once. Resolves to an empty list on failure (and lets a
 * later call retry), since the locally known replies are still shown either way.
 */
export function ensureThreadRepliesLoaded(client: MatrixClient, room: Room, rootId: string): Promise<MatrixEvent[]> {
    const key = `${room.roomId}|${rootId}`;
    let load = loads.get(key);
    if (!load) {
        load = fetchAll(client, room.roomId, rootId).then(
            (events) => {
                loaded.set(key, events);
                return events;
            },
            () => {
                loads.delete(key);
                return [];
            },
        );
        loads.set(key, load);
    }
    return load;
}

async function fetchAll(client: MatrixClient, roomId: string, rootId: string): Promise<MatrixEvent[]> {
    const all: MatrixEvent[] = [];
    let from: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
        const { events, nextBatch } = await client.relations(roomId, rootId, RelationType.Thread, null, {
            dir: Direction.Backward,
            limit: PAGE_SIZE,
            from,
        });
        all.push(...events);
        if (!nextBatch) break;
        from = nextBatch;
    }
    return all;
}

/**
 * The reply count a post's card should show: `localCount` (its direct replies among the locally
 * known events - see replyCountFor), topped up from the full thread once it's loaded when the
 * server says `event` is a thread root. The local pools usually hold only part of a thread, which
 * would otherwise undercount a root's direct replies or miss them entirely. Kept as the larger of
 * the two so a reply that arrives after the one-time fetch still counts.
 */
export function useDirectReplyCount(client: MatrixClient, room: Room, event: MatrixEvent, localCount: number): number {
    const eventId = event.getId();
    const isThreadRoot = !!eventId && !event.isSending() && !!event.getServerAggregatedRelation(RelationType.Thread);
    // Keyed by root so a tile reused for another post never counts the previous post's thread.
    const [fetched, setFetched] = useState<{ rootId: string; events: MatrixEvent[] } | undefined>();
    useEffect(() => {
        if (!isThreadRoot || !eventId) return;
        let cancelled = false;
        void ensureThreadRepliesLoaded(client, room, eventId).then((events) => {
            if (!cancelled) setFetched({ rootId: eventId, events });
        });
        return () => {
            cancelled = true;
        };
    }, [client, room, eventId, isThreadRoot]);
    if (!isThreadRoot || !eventId) return localCount;
    const threadEvents =
        fetched?.rootId === eventId ? fetched.events : getLoadedThreadReplies(room.roomId, eventId);
    if (!threadEvents) return localCount;
    return Math.max(localCount, countDirectReplies([threadEvents], eventId));
}

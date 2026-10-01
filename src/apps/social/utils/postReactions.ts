/*
 * Social Overlay - postReactions
 *
 * Fetches a post's full set of reactions from the server and feeds them into the room's own
 * relations index (room.relations), which every reaction count in Social already reads from (see
 * SocialReactionsRow's getPostReactions and SocialEventTile's own Like/Repost counts).
 *
 * Needed because that index only ever holds reaction events that happen to be in the client's
 * locally synced timeline. Social never opens rooms through the normal timeline, so for an older
 * post, most of its reactions were sent long after the post itself and sit outside whatever
 * window got synced or backfilled. Confirmed live: an old post opened from a "liked your post"
 * notification showed 1 like / 1 repost instead of its real 29 / 25, and only showed the full
 * set after opening it once in the stock room timeline (whose own pagination happened to pull
 * those reaction events in).
 */

import EventEmitter from "events";
import {
    Direction,
    EventType,
    type MatrixClient,
    type MatrixEvent,
    RelationType,
    type Room,
    RoomEvent,
} from "matrix-js-sdk/src/matrix";

/** Stops a post with an extreme number of reactions from paging forever. */
const MAX_PAGES = 10;
const PAGE_SIZE = 100;

/** One fetch per post per session - `${roomId}|${eventId}` to its in-flight or settled fetch. */
const loads = new Map<string, Promise<void>>();

/**
 * Reaction events this module fetched itself, keyed by event id. These are separate MatrixEvent
 * objects from anything in the room's timeline, so the room's own redaction handling (which looks
 * events up via room.findEventById) never finds them - see watchRedactions below.
 */
const fetchedReactions = new Map<string, { event: MatrixEvent; room: Room }>();

const emitter = new EventEmitter();
const LOADED = "loaded";

/**
 * Subscribes to "a post's reactions just finished loading". A post with zero locally known
 * reactions has no Relations object at all until the first one is aggregated, and aggregating
 * doesn't fire Room.timeline, so a tile still waiting for its Relations object to exist needs this
 * to know when to look again. Returns an unsubscribe function.
 */
export function onPostReactionsLoaded(listener: (roomId: string, eventId: string) => void): () => void {
    emitter.on(LOADED, listener);
    return () => {
        emitter.off(LOADED, listener);
    };
}

/**
 * Loads every reaction on `event` from the server into `room.relations`, once per session.
 * Safe to call repeatedly and from many tiles at once. Failures are swallowed: the locally known
 * reactions are still shown either way, this only ever adds to them.
 */
export function ensurePostReactionsLoaded(client: MatrixClient, room: Room, event: MatrixEvent): Promise<void> {
    const eventId = event.getId();
    if (!eventId || event.isSending()) return Promise.resolve();
    const key = `${room.roomId}|${eventId}`;
    let load = loads.get(key);
    if (!load) {
        watchRedactions(client);
        load = fetchAll(client, room, event, eventId).catch(() => {
            // Let a later call retry instead of caching the failure for the rest of the session.
            loads.delete(key);
        });
        loads.set(key, load);
    }
    return load;
}

async function fetchAll(client: MatrixClient, room: Room, target: MatrixEvent, eventId: string): Promise<void> {
    const timelineSet = room.getUnfilteredTimelineSet();
    let from: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
        const { events, nextBatch } = await client.relations(
            room.roomId,
            eventId,
            RelationType.Annotation,
            EventType.Reaction,
            { dir: Direction.Backward, limit: PAGE_SIZE, from },
        );
        for (const reaction of events) {
            const id = reaction.getId();
            // Already in the timeline (and so already aggregated, and redacted by the room itself
            // if it ever is) - nothing to add.
            if (!id || room.findEventById(id)) continue;
            fetchedReactions.set(id, { event: reaction, room });
            // Relations.addEvent ignores ids it already holds, so a reaction that later arrives
            // through the timeline as well is never counted twice.
            await room.relations.aggregateChildEvent(reaction, timelineSet, target);
        }
        if (!nextBatch) break;
        from = nextBatch;
    }
    emitter.emit(LOADED, room.roomId, eventId);
}

let watchedClient: MatrixClient | null = null;

/**
 * Applies redactions (e.g. someone un-liking) to the reaction copies this module fetched. The room
 * only redacts events it can find in its own timelines, so without this an un-like of a reaction
 * that was only ever known through this module would leave the count stuck one too high.
 */
function watchRedactions(client: MatrixClient): void {
    if (watchedClient === client) return;
    watchedClient = client;
    const onEvent = (redaction: MatrixEvent): void => {
        // A still-sending (or failed/cancelled) local echo might never actually go through - only
        // act once it has (status is cleared back to null on a successful send).
        if (!redaction.isRedaction() || redaction.status !== null) return;
        const redactsId = redaction.event.redacts ?? redaction.getContent().redacts;
        if (!redactsId) return;
        const fetched = fetchedReactions.get(redactsId);
        if (!fetched || fetched.event.isRedacted()) return;
        fetchedReactions.delete(redactsId);
        // Emits BeforeRedaction, which the owning Relations object listens for to drop it.
        fetched.event.makeRedacted(redaction, fetched.room);
    };
    // Timeline covers redactions arriving via sync; LocalEchoUpdated covers our own un-like the
    // moment the server accepts it, rather than waiting for its remote echo.
    client.on(RoomEvent.Timeline, onEvent);
    client.on(RoomEvent.LocalEchoUpdated, onEvent);
}

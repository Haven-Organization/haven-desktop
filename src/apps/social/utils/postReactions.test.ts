/*
 * Social Overlay - postReactions tests
 *
 * Regression coverage for "an old post opened from a notification shows 1 like / 1 repost instead
 * of its real 29 / 25 until it's opened once in the stock room timeline" - see postReactions.ts.
 */

// @vitest-environment happy-dom
// test-utils transitively imports code that calls window.btoa at module load time - see
// social-actions.test.ts's own identical directive.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    EventType,
    type MatrixClient,
    MatrixEvent,
    RelationType,
    Room,
    RoomEvent,
} from "matrix-js-sdk/src/matrix";
import { createTestClient, mkEvent } from "test-utils";

import { ensurePostReactionsLoaded, onPostReactionsLoaded } from "./postReactions";

const ROOM_ID = "!room:example.org";
let counter = 0;

function mkPost(): MatrixEvent {
    return mkEvent({
        event: true,
        type: EventType.RoomMessage,
        room: ROOM_ID,
        user: "@poster:example.org",
        content: { body: "a post" },
        id: `$post-${++counter}`,
    });
}

function mkReaction(target: MatrixEvent, key: string, sender: string): MatrixEvent {
    return mkEvent({
        event: true,
        type: EventType.Reaction,
        room: ROOM_ID,
        user: sender,
        content: { "m.relates_to": { rel_type: RelationType.Annotation, event_id: target.getId()!, key } },
        id: `$reaction-${++counter}`,
    });
}

function countFor(room: Room, post: MatrixEvent, key: string): number {
    const relations = room.relations.getChildEventsForEvent(post.getId()!, RelationType.Annotation, EventType.Reaction);
    return relations?.getSortedAnnotationsByKey()?.find(([k]) => k === key)?.[1].size ?? 0;
}

describe("ensurePostReactionsLoaded", () => {
    let client: MatrixClient;
    let room: Room;

    beforeEach(() => {
        client = createTestClient();
        room = new Room(ROOM_ID, client, "@me:example.org");
    });

    it("adds every server-side reaction to the room's own relations index", async () => {
        const post = mkPost();
        const reactions = [
            mkReaction(post, "👍", "@a:example.org"),
            mkReaction(post, "👍", "@b:example.org"),
            mkReaction(post, "🔁", "@a:example.org"),
        ];
        client.relations = vi.fn().mockResolvedValue({ events: reactions, nextBatch: null });

        await ensurePostReactionsLoaded(client, room, post);

        expect(countFor(room, post, "👍")).toBe(2);
        expect(countFor(room, post, "🔁")).toBe(1);
    });

    it("pages through every batch the server reports", async () => {
        const post = mkPost();
        client.relations = vi
            .fn()
            .mockResolvedValueOnce({ events: [mkReaction(post, "👍", "@a:example.org")], nextBatch: "next" })
            .mockResolvedValueOnce({ events: [mkReaction(post, "👍", "@b:example.org")], nextBatch: null });

        await ensurePostReactionsLoaded(client, room, post);

        expect(client.relations).toHaveBeenCalledTimes(2);
        expect(vi.mocked(client.relations).mock.calls[1][4]).toEqual(expect.objectContaining({ from: "next" }));
        expect(countFor(room, post, "👍")).toBe(2);
    });

    it("only fetches a given post once per session", async () => {
        const post = mkPost();
        client.relations = vi.fn().mockResolvedValue({ events: [], nextBatch: null });

        await Promise.all([ensurePostReactionsLoaded(client, room, post), ensurePostReactionsLoaded(client, room, post)]);
        await ensurePostReactionsLoaded(client, room, post);

        expect(client.relations).toHaveBeenCalledTimes(1);
    });

    it("retries on a later call if the fetch failed", async () => {
        const post = mkPost();
        client.relations = vi
            .fn()
            .mockRejectedValueOnce(new Error("network"))
            .mockResolvedValueOnce({ events: [mkReaction(post, "👍", "@a:example.org")], nextBatch: null });

        await ensurePostReactionsLoaded(client, room, post);
        await ensurePostReactionsLoaded(client, room, post);

        expect(client.relations).toHaveBeenCalledTimes(2);
        expect(countFor(room, post, "👍")).toBe(1);
    });

    it("tells listeners once a post's reactions have loaded", async () => {
        const post = mkPost();
        client.relations = vi.fn().mockResolvedValue({ events: [], nextBatch: null });
        const listener = vi.fn();
        const unsubscribe = onPostReactionsLoaded(listener);

        await ensurePostReactionsLoaded(client, room, post);
        unsubscribe();

        expect(listener).toHaveBeenCalledWith(ROOM_ID, post.getId());
    });

    it("drops a fetched reaction from the count once it's redacted (someone un-likes)", async () => {
        const post = mkPost();
        const like = mkReaction(post, "👍", "@a:example.org");
        client.relations = vi.fn().mockResolvedValue({ events: [like], nextBatch: null });
        await ensurePostReactionsLoaded(client, room, post);
        expect(countFor(room, post, "👍")).toBe(1);

        const redaction = new MatrixEvent({
            type: EventType.RoomRedaction,
            room_id: ROOM_ID,
            sender: "@a:example.org",
            event_id: `$redaction-${++counter}`,
            redacts: like.getId()!,
            content: {},
        });
        client.emit(RoomEvent.Timeline, redaction, room, false, false, {} as any);

        expect(countFor(room, post, "👍")).toBe(0);
    });
});

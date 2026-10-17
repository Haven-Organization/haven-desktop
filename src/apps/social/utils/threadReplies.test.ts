/*
 * Social Overlay - threadReplies tests
 *
 * Regression coverage for "a post with 8 bridged thread replies shows none of them, and its
 * Reply button counts all 8 instead of its 1 direct reply" - see threadReplies.ts.
 */

// @vitest-environment happy-dom
// test-utils transitively imports code that calls window.btoa at module load time - see
// social-actions.test.ts's own identical directive.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventType, type MatrixClient, type MatrixEvent, RelationType, Room } from "matrix-js-sdk/src/matrix";
import { createTestClient, mkEvent } from "test-utils";

import { ensureThreadRepliesLoaded, getLoadedThreadReplies } from "./threadReplies";
import { countDirectReplies } from "./thread-relations";

const ROOM_ID = "!room:example.org";
let counter = 0;

function mkThreadReply(rootId: string, inReplyTo: string): MatrixEvent {
    return mkEvent({
        event: true,
        type: EventType.RoomMessage,
        room: ROOM_ID,
        user: "@replier:example.org",
        content: {
            "body": "a reply",
            "m.relates_to": {
                "rel_type": RelationType.Thread,
                "event_id": rootId,
                "is_falling_back": true,
                "m.in_reply_to": { event_id: inReplyTo },
            },
        },
        id: `$reply-${++counter}`,
    });
}

describe("ensureThreadRepliesLoaded", () => {
    let client: MatrixClient;
    let room: Room;

    beforeEach(() => {
        client = createTestClient();
        room = new Room(ROOM_ID, client, "@me:example.org");
    });

    it("pages through the whole thread, so a chain's only direct reply is found", async () => {
        const rootId = `$root-${++counter}`;
        // Oldest first: one direct reply to the root, then a chain hanging off it.
        const chain: MatrixEvent[] = [mkThreadReply(rootId, rootId)];
        for (let i = 0; i < 7; i++) chain.push(mkThreadReply(rootId, chain[chain.length - 1].getId()!));
        const newestFirst = [...chain].reverse();
        client.relations = vi
            .fn()
            .mockResolvedValueOnce({ events: newestFirst.slice(0, 5), nextBatch: "next" })
            .mockResolvedValueOnce({ events: newestFirst.slice(5), nextBatch: null });

        const events = await ensureThreadRepliesLoaded(client, room, rootId);

        expect(client.relations).toHaveBeenCalledTimes(2);
        expect(vi.mocked(client.relations).mock.calls[1][4]).toEqual(expect.objectContaining({ from: "next" }));
        expect(events).toHaveLength(8);
        expect(countDirectReplies([events], rootId)).toBe(1);
        expect(countDirectReplies([events], chain[0].getId()!)).toBe(1);
        expect(getLoadedThreadReplies(ROOM_ID, rootId)).toBe(events);
    });

    it("fetches each thread only once per session", async () => {
        const rootId = `$root-${++counter}`;
        client.relations = vi.fn().mockResolvedValue({ events: [mkThreadReply(rootId, rootId)], nextBatch: null });

        await Promise.all([ensureThreadRepliesLoaded(client, room, rootId), ensureThreadRepliesLoaded(client, room, rootId)]);
        await ensureThreadRepliesLoaded(client, room, rootId);

        expect(client.relations).toHaveBeenCalledTimes(1);
    });

    it("resolves to nothing on failure and lets a later call retry", async () => {
        const rootId = `$root-${++counter}`;
        client.relations = vi
            .fn()
            .mockRejectedValueOnce(new Error("nope"))
            .mockResolvedValueOnce({ events: [mkThreadReply(rootId, rootId)], nextBatch: null });

        expect(await ensureThreadRepliesLoaded(client, room, rootId)).toEqual([]);
        expect(getLoadedThreadReplies(ROOM_ID, rootId)).toBeUndefined();
        expect(await ensureThreadRepliesLoaded(client, room, rootId)).toHaveLength(1);
        expect(client.relations).toHaveBeenCalledTimes(2);
    });
});

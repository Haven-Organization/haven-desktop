/*
 * Haven: tests for a webxdc game's moves.
 */

// @vitest-environment happy-dom

import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventStatus, type MatrixClient, MatrixEvent, RoomEvent } from "matrix-js-sdk/src/matrix";

import { getMockClientWithEventEmitter } from "test-utils";
import { WEBXDC_UPDATE_EVENT_TYPE } from "./webxdc";
import { WebxdcUpdates, WebxdcUpdateTooLargeError } from "./WebxdcUpdates";

const ROOM = "!room:example.org";
const GAME = "$game";

function move(id: string, payload: unknown, relatesTo = GAME): MatrixEvent {
    return new MatrixEvent({
        type: WEBXDC_UPDATE_EVENT_TYPE,
        event_id: id,
        room_id: ROOM,
        sender: "@alice:example.org",
        content: {
            "m.relates_to": { rel_type: "m.reference", event_id: relatesTo },
            "update": { payload, summary: "a summary", extra: "dropped" },
            "body": "",
        },
    });
}

describe("WebxdcUpdates", () => {
    let client: MatrixClient;

    beforeEach(() => {
        client = getMockClientWithEventEmitter({
            relations: vi.fn(),
            sendEvent: vi.fn().mockResolvedValue({ event_id: "$sent" }),
            decryptEventIfNeeded: vi.fn().mockResolvedValue(undefined),
        });
    });

    it("reads the moves so far, oldest first, across pages", async () => {
        vi.mocked(client.relations)
            .mockResolvedValueOnce({
                events: [move("$3", 3), move("$2", 2)],
                nextBatch: "next",
            })
            .mockResolvedValueOnce({
                events: [move("$1", 1)],
                nextBatch: null,
            });
        const updates = new WebxdcUpdates(client, ROOM, GAME);
        await updates.start();

        expect(updates.since(0)).toEqual([
            { payload: 1, summary: "a summary", serial: 1, max_serial: 3 },
            { payload: 2, summary: "a summary", serial: 2, max_serial: 3 },
            { payload: 3, summary: "a summary", serial: 3, max_serial: 3 },
        ]);
        expect(updates.since(2).map((u) => u.payload)).toEqual([3]);
        expect(vi.mocked(client.relations).mock.calls[1][4]).toMatchObject({
            from: "next",
        });
    });

    it("passes on new moves for this game once, and ignores others", async () => {
        vi.mocked(client.relations).mockResolvedValue({
            events: [move("$1", 1)],
            nextBatch: null,
        });
        const updates = new WebxdcUpdates(client, ROOM, GAME);
        await updates.start();
        const listener = vi.fn();
        updates.onUpdates(listener);
        const room = { roomId: ROOM };

        client.emit(RoomEvent.Timeline, move("$2", 2), room as any, false, false, {} as any);
        client.emit(RoomEvent.Timeline, move("$2", 2), room as any, false, false, {} as any);
        client.emit(RoomEvent.Timeline, move("$x", 9, "$another-game"), room as any, false, false, {} as any);
        await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
        expect(listener).toHaveBeenCalledWith([{ payload: 2, summary: "a summary", serial: 2, max_serial: 2 }]);
    });

    it("waits for a move of one's own to reach the server", async () => {
        vi.mocked(client.relations).mockResolvedValue({
            events: [],
            nextBatch: null,
        });
        const updates = new WebxdcUpdates(client, ROOM, GAME);
        await updates.start();
        const listener = vi.fn();
        updates.onUpdates(listener);

        const pending = move("~local", 1);
        pending.setStatus(EventStatus.SENDING);
        client.emit(RoomEvent.LocalEchoUpdated, pending, { roomId: ROOM } as any, undefined, undefined);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(listener).not.toHaveBeenCalled();

        const sent = move("$sent", 1);
        sent.setStatus(EventStatus.SENT);
        client.emit(RoomEvent.LocalEchoUpdated, sent, { roomId: ROOM } as any, "~local", EventStatus.SENDING);
        await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    });

    it("sends a move as a reference to the game", async () => {
        vi.mocked(client.relations).mockResolvedValue({
            events: [],
            nextBatch: null,
        });
        const updates = new WebxdcUpdates(client, ROOM, GAME);
        await updates.send(
            {
                payload: { move: "e4" },
                info: "Alice moved",
                notify: { "*": "x" },
            },
            "moved",
        );
        expect(client.sendEvent).toHaveBeenCalledWith(ROOM, WEBXDC_UPDATE_EVENT_TYPE, {
            "m.relates_to": { rel_type: "m.reference", event_id: GAME },
            "update": { payload: { move: "e4" }, info: "Alice moved" },
            "body": "moved",
        });
    });

    it("refuses a move too large for an event", async () => {
        const updates = new WebxdcUpdates(client, ROOM, GAME);
        await expect(updates.send({ payload: "x".repeat(60_000) }, "")).rejects.toBeInstanceOf(
            WebxdcUpdateTooLargeError,
        );
        expect(client.sendEvent).not.toHaveBeenCalled();
    });
});

// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEvent, type MatrixClient, MatrixEvent } from "matrix-js-sdk/src/matrix";

import {
    rememberedParentId,
    rememberedThreadRootId,
    rememberPostRelation,
    startPostRelationMemory,
} from "./postRelationMemory";

function threadReply(id: string, parent: string, root: string): MatrixEvent {
    return new MatrixEvent({
        event_id: id,
        type: "m.room.message",
        room_id: "!room:example.org",
        sender: "@alice:example.org",
        origin_server_ts: 1000,
        content: {
            "msgtype": "m.text",
            "body": "a reply",
            "m.relates_to": { "rel_type": "m.thread", "event_id": root, "m.in_reply_to": { event_id: parent } },
        },
    });
}

describe("postRelationMemory", () => {
    let handlers: Array<(e: MatrixEvent) => void>;
    let client: MatrixClient;
    let stop: () => void;

    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
        handlers = [];
        client = {
            getUserId: () => "@me:example.org",
            on: (name: string, fn: (e: MatrixEvent) => void) => name === ClientEvent.Event && handlers.push(fn),
            off: vi.fn(),
        } as unknown as MatrixClient;
        stop = startPostRelationMemory(client);
    });

    afterEach(() => {
        stop();
        vi.useRealTimers();
    });

    it("records a threaded post's parent and root as it arrives from sync", () => {
        handlers.forEach((fn) => fn(threadReply("$reply", "$parent", "$root")));
        expect(rememberedParentId("$reply")).toBe("$parent");
        expect(rememberedThreadRootId("$reply")).toBe("$root");
    });

    it("keeps the record after the post is deleted and Haven restarts", () => {
        const reply = threadReply("$reply", "$parent", "$root");
        rememberPostRelation(reply);
        reply.makeRedacted(
            new MatrixEvent({ type: "m.room.redaction", event_id: "$redaction", redacts: "$reply", content: {} }),
            { getVersion: () => "10" } as never,
        );
        rememberPostRelation(reply); // the redacted copy changes nothing
        vi.advanceTimersByTime(5000);
        stop();
        expect(rememberedParentId("$reply")).toBeUndefined();

        stop = startPostRelationMemory(client);
        expect(rememberedParentId("$reply")).toBe("$parent");
        expect(rememberedThreadRootId("$reply")).toBe("$root");
    });

    it("ignores events that aren't in a thread", () => {
        rememberPostRelation(
            new MatrixEvent({ event_id: "$plain", type: "m.room.message", content: { msgtype: "m.text", body: "hi" } }),
        );
        expect(rememberedParentId("$plain")).toBeUndefined();
    });
});

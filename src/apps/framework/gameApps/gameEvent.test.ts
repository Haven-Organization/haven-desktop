// @vitest-environment happy-dom
// Haven: fetching a game app's message - only the server saying it's gone counts as gone.
import { describe, expect, it, vi } from "vitest";
import { type MatrixClient, MatrixError, MatrixEvent } from "matrix-js-sdk/src/matrix";

import { fetchGameEvent, isMissingEventError } from "./gameEvent";

function clientFetching(result: () => Promise<object>): MatrixClient {
    return {
        getRoom: () => null,
        fetchRoomEvent: vi.fn(result),
        getEventMapper: () => (raw: object) => new MatrixEvent(raw),
        decryptEventIfNeeded: vi.fn().mockResolvedValue(undefined),
    } as unknown as MatrixClient;
}

describe("fetchGameEvent", () => {
    it("returns the message from the server", async () => {
        const client = clientFetching(async () => ({ event_id: "$game", type: "m.room.message", content: {} }));
        expect((await fetchGameEvent(client, "!room", "$game"))?.getId()).toBe("$game");
    });

    it.each([
        ["not found", new MatrixError({ errcode: "M_NOT_FOUND" }, 404)],
        ["forbidden", new MatrixError({ errcode: "M_FORBIDDEN" }, 403)],
    ])("is null when the server says the message is %s", async (_, error) => {
        const client = clientFetching(async () => {
            throw error;
        });
        await expect(fetchGameEvent(client, "!room", "$game")).resolves.toBeNull();
    });

    it.each([
        ["a network failure", new TypeError("Failed to fetch")],
        ["a server error", new MatrixError({ errcode: "M_UNKNOWN" }, 502)],
    ])("throws on %s, which says nothing about the message", async (_, error) => {
        const client = clientFetching(async () => {
            throw error;
        });
        await expect(fetchGameEvent(client, "!room", "$game")).rejects.toBe(error);
    });
});

describe("isMissingEventError", () => {
    it("is only the server saying the message doesn't exist or can't be seen", () => {
        expect(isMissingEventError(new MatrixError({ errcode: "M_NOT_FOUND" }, 404))).toBe(true);
        expect(isMissingEventError(new MatrixError({}, 403))).toBe(true);
        expect(isMissingEventError(new MatrixError({ errcode: "M_LIMIT_EXCEEDED" }, 429))).toBe(false);
        expect(isMissingEventError(new Error("offline"))).toBe(false);
    });
});

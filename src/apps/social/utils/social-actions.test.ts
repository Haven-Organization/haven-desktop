// @vitest-environment happy-dom
// social-actions.ts transitively imports FileBodyViewModel.ts, which calls window.btoa at module
// load time - the project's default "node" test environment provides no DOM globals at all, so
// even just importing getProfileRoomLink crashes without this (see permalinkRouting.test.ts's own
// identical directive/comment for the same underlying reason).
import { describe, it, expect, vi } from "vitest";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { getProfileRoomLink } from "./social-actions";
import { MSC4501_PROFILE_ROOM_KEY, MSC4501_PROFILE_ROOM_ID_KEY_LEGACY } from "./room-classifier";

function fakeClient(profile: Record<string, unknown>): MatrixClient {
    return { getProfileInfo: vi.fn().mockResolvedValue(profile) } as unknown as MatrixClient;
}

describe("getProfileRoomLink", () => {
    it("reads the current block-shaped profile_room key", async () => {
        const client = fakeClient({ [MSC4501_PROFILE_ROOM_KEY]: { room_id: "!new:example.org", via: ["example.org"] } });
        expect(await getProfileRoomLink(client, "@q:example.org")).toBe("!new:example.org");
    });

    it("falls back to the legacy flat-string profile_room_id key when the new key is absent", async () => {
        const client = fakeClient({ [MSC4501_PROFILE_ROOM_ID_KEY_LEGACY]: "!legacy:example.org" });
        expect(await getProfileRoomLink(client, "@q:example.org")).toBe("!legacy:example.org");
    });

    it("prefers the new key over the legacy one when both are present", async () => {
        const client = fakeClient({
            [MSC4501_PROFILE_ROOM_KEY]: { room_id: "!new:example.org" },
            [MSC4501_PROFILE_ROOM_ID_KEY_LEGACY]: "!legacy:example.org",
        });
        expect(await getProfileRoomLink(client, "@q:example.org")).toBe("!new:example.org");
    });

    it("returns null when neither key is present", async () => {
        const client = fakeClient({});
        expect(await getProfileRoomLink(client, "@q:example.org")).toBeNull();
    });

    it("returns null for a malformed new-key value (not an object with room_id)", async () => {
        const client = fakeClient({ [MSC4501_PROFILE_ROOM_KEY]: "!oldshape:example.org" });
        expect(await getProfileRoomLink(client, "@q:example.org")).toBeNull();
    });

    it("returns null when the request throws", async () => {
        const client = { getProfileInfo: vi.fn().mockRejectedValue(new Error("network")) } as unknown as MatrixClient;
        expect(await getProfileRoomLink(client, "@q:example.org")).toBeNull();
    });
});

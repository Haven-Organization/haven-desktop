// @vitest-environment happy-dom
// social-actions.ts transitively imports FileBodyViewModel.ts, which calls window.btoa at module
// load time - the project's default "node" test environment provides no DOM globals at all, so
// even just importing getProfileRoomLink crashes without this (see permalinkRouting.test.ts's own
// identical directive/comment for the same underlying reason).
import { describe, it, expect, vi } from "vitest";
import { type MatrixClient, KnownMembership } from "matrix-js-sdk/src/matrix";
import { mkStubRoom, createTestClient } from "test-utils";

import { getProfileRoomLink, sendRepost, type RepostContent } from "./social-actions";
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

// Regression coverage for a real "reply/repost/like on a peeked post" fix - a repost/quote-post
// always lands fine in the reposting user's own room (targetRoomId below) regardless of their
// membership elsewhere, but the 🔁 reaction this function separately annotates the *original*
// event with needs real membership in *that* event's own room, which a peeked (not-joined) room
// never has. See showActionRequiresFollowModal in SocialEventTile.tsx for the companion fix that
// gates Reply/Repost/Like's own buttons the same way - unlike those, a quote-post keeps working
// here (its commentary has real value on its own), it just shouldn't bother attempting a reaction
// send it already knows will fail.
describe("sendRepost", () => {
    function reactionCallsOf(client: MatrixClient): unknown[][] {
        return (client.sendEvent as ReturnType<typeof vi.fn>).mock.calls.filter(
            ([, type]: unknown[]) => type === "m.reaction",
        );
    }

    function repost(roomId: string): RepostContent {
        return {
            event_id: "$original",
            room_id: roomId,
            sender: "@other:example.org",
            content: { body: "the original post" },
        };
    }

    it("skips the 🔁 reaction attempt when not a member of the reposted event's own room", async () => {
        const client = createTestClient();
        const originalRoom = mkStubRoom("!original:example.org", "Original", client);
        originalRoom.getMyMembership = vi.fn().mockReturnValue(KnownMembership.Leave);
        client.getRoom = vi.fn().mockReturnValue(originalRoom);
        client.sendEvent = vi.fn().mockResolvedValue({ event_id: "$sent" });

        const result = await sendRepost(client, "!myProfile:example.org", "check this out", repost(originalRoom.roomId));

        expect(result).toEqual({ reactionSent: false });
        expect(reactionCallsOf(client)).toHaveLength(0);
        // The repost/quote-post itself still sends, into the reposting user's own room - callers
        // (SocialEventTile.tsx's boost button) rely on this to optimistically show itself as
        // reposted even though reactionSent came back false.
        expect(client.sendEvent).toHaveBeenCalledWith(
            "!myProfile:example.org",
            expect.any(String),
            expect.objectContaining({ body: "check this out" }),
        );
    });

    it("still sends the 🔁 reaction when actually a member of the reposted event's own room", async () => {
        const client = createTestClient();
        const originalRoom = mkStubRoom("!original:example.org", "Original", client);
        originalRoom.getMyMembership = vi.fn().mockReturnValue(KnownMembership.Join);
        client.getRoom = vi.fn().mockReturnValue(originalRoom);
        client.sendEvent = vi.fn().mockResolvedValue({ event_id: "$sent" });

        const result = await sendRepost(client, "!myProfile:example.org", "check this out", repost(originalRoom.roomId));

        expect(result).toEqual({ reactionSent: true });
        expect(reactionCallsOf(client)).toHaveLength(1);
    });

    it("reports reactionSent: false (without throwing) when the reaction send itself fails despite being a member", async () => {
        const client = createTestClient();
        const originalRoom = mkStubRoom("!original:example.org", "Original", client);
        originalRoom.getMyMembership = vi.fn().mockReturnValue(KnownMembership.Join);
        client.getRoom = vi.fn().mockReturnValue(originalRoom);
        client.sendEvent = vi
            .fn()
            .mockResolvedValueOnce({ event_id: "$sent" }) // the repost/quote-post itself
            .mockRejectedValueOnce(new Error("rate limited")); // the reaction

        await expect(
            sendRepost(client, "!myProfile:example.org", "check this out", repost(originalRoom.roomId)),
        ).resolves.toEqual({ reactionSent: false });
    });
});

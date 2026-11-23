// @vitest-environment happy-dom
// social-actions.ts transitively imports FileBodyViewModel.ts, which calls window.btoa at module
// load time - the project's default "node" test environment provides no DOM globals at all, so
// even just importing getProfileRoomLink crashes without this (see permalinkRouting.test.ts's own
// identical directive/comment for the same underlying reason).
import { describe, it, expect, vi } from "vitest";
import { type MatrixClient, EventStatus, KnownMembership, MatrixError, MatrixEvent } from "matrix-js-sdk/src/matrix";
import { mkStubRoom, createTestClient } from "test-utils";

import { canPostIn, getProfileRoomLink, sendPost, sendRepost, type RepostContent } from "./social-actions";
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
            expect.any(String),
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

// Haven: following someone joins their profile room, which usually only they can post in, so
// Social's "Post to" choices go by permission, not membership.
describe("canPostIn", () => {
    it("is true when joined and allowed to send a post", () => {
        const room = mkStubRoom("!profile:example.org", "Profile", createTestClient());
        expect(canPostIn(room, "@me:example.org")).toBe(true);
        expect(room.currentState.maySendEvent).toHaveBeenCalledWith("m.room.message", "@me:example.org");
    });

    it("is false in a room you've joined but can't post in", () => {
        const room = mkStubRoom("!profile:example.org", "Profile", createTestClient());
        vi.mocked(room.currentState.maySendEvent).mockReturnValue(false);
        expect(canPostIn(room, "@me:example.org")).toBe(false);
    });

    it("is false in a room you haven't joined", () => {
        const room = mkStubRoom("!profile:example.org", "Profile", createTestClient());
        room.getMyMembership = vi.fn().mockReturnValue(KnownMembership.Invite);
        expect(canPostIn(room, "@me:example.org")).toBe(false);
    });
});

// Haven: a refused post shows its error in Social, so the unsent copy shouldn't also be left in
// the room's timeline to cancel by hand.
describe("sendPost when the server refuses it", () => {
    function unsentEvent(): MatrixEvent {
        const event = new MatrixEvent({ type: "m.room.message", content: { body: "hi" } });
        event.setStatus(EventStatus.NOT_SENT);
        return event;
    }

    it("drops the unsent copy and still throws", async () => {
        const client = createTestClient();
        const unsent = unsentEvent();
        const error = new MatrixError({ errcode: "M_FORBIDDEN" }, 403);
        error.event = unsent;
        client.sendEvent = vi.fn().mockRejectedValue(error);

        await expect(sendPost(client, "!profile:example.org", "hi")).rejects.toBe(error);
        expect(client.cancelPendingEvent).toHaveBeenCalledWith(unsent);
    });

    it("finds the unsent copy by its transaction id when the error doesn't carry it", async () => {
        const client = createTestClient();
        const room = mkStubRoom("!profile:example.org", "Profile", client);
        const unsent = unsentEvent();
        client.getRoom = vi.fn().mockReturnValue(room);
        client.sendEvent = vi.fn().mockImplementation((_roomId, _type, _content, txnId: string) => {
            unsent.setTxnId(txnId);
            return Promise.reject(new TypeError("Failed to fetch"));
        });
        room.getPendingEvents = vi.fn().mockReturnValue([unsent]);

        await expect(sendPost(client, "!profile:example.org", "hi")).rejects.toThrow("Failed to fetch");
        expect(client.cancelPendingEvent).toHaveBeenCalledWith(unsent);
    });

    it("leaves a sent post alone", async () => {
        const client = createTestClient();
        client.sendEvent = vi.fn().mockResolvedValue({ event_id: "$sent" });
        await sendPost(client, "!profile:example.org", "hi");
        expect(client.cancelPendingEvent).not.toHaveBeenCalled();
    });
});

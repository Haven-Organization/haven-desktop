// @vitest-environment happy-dom

import { describe, it, expect, vi } from "vitest";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";

import { resolveFollowState } from "./SocialPersonRow";
import { MSC4501_PROFILE_ROOM_KEY } from "../utils/room-classifier";

// Each case uses its own user and room IDs: the profile and join-rule lookups are cached per ID
function clientFor(
    profile: Record<string, unknown>,
    opts: { membership?: string; joinRule?: string; summaryFails?: boolean } = {},
): MatrixClient {
    return {
        getProfileInfo: vi.fn().mockResolvedValue(profile),
        getRoom: () => (opts.membership ? { getMyMembership: () => opts.membership } : null),
        getRoomSummary: opts.summaryFails
            ? vi.fn().mockRejectedValue(new Error("forbidden"))
            : vi.fn().mockResolvedValue({ join_rule: opts.joinRule }),
    } as unknown as MatrixClient;
}

const link = (roomId: string) => ({ [MSC4501_PROFILE_ROOM_KEY]: { room_id: roomId, via: ["example.com"] } });

describe("resolveFollowState", () => {
    it("is No Profile without a linked profile room", async () => {
        expect(await resolveFollowState(clientFor({}), "@a:example.com")).toEqual({ kind: "no_profile" });
    });

    it("is Following or Requested from your membership", async () => {
        const joined = clientFor(link("!b:example.com"), { membership: KnownMembership.Join });
        expect(await resolveFollowState(joined, "@b:example.com")).toEqual({ kind: "following" });
        const knocked = clientFor(link("!c:example.com"), { membership: KnownMembership.Knock });
        expect(await resolveFollowState(knocked, "@c:example.com")).toEqual({ kind: "requested" });
    });

    it("offers Follow for a public room and Request Follow for a knock room", async () => {
        expect(await resolveFollowState(clientFor(link("!d:example.com"), { joinRule: "public" }), "@d:example.com")).toEqual({
            kind: "follow",
            room: { roomId: "!d:example.com", via: ["example.com"] },
        });
        expect(
            (await resolveFollowState(clientFor(link("!e:example.com"), { joinRule: "knock_restricted" }), "@e:example.com"))
                .kind,
        ).toBe("request");
    });

    it("is Private for an invite-only room or a refused summary", async () => {
        expect((await resolveFollowState(clientFor(link("!f:example.com"), { joinRule: "invite" }), "@f:example.com")).kind).toBe(
            "private",
        );
        expect((await resolveFollowState(clientFor(link("!g:example.com"), { summaryFails: true }), "@g:example.com")).kind).toBe(
            "private",
        );
    });
});

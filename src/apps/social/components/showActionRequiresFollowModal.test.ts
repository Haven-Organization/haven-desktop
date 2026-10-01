/*
 * Social Overlay - showActionRequiresFollowModal tests
 *
 * Reply/Repost/Like are impossible to actually complete from a room the viewer is only peeking
 * (not joined) - opening someone's profile without following them first, or clicking a repost
 * card pointing at a room the viewer has never joined, both land here. This checks the modal
 * shown for each of the three join_rule shapes uses the right wording and mechanism, matching the
 * user-facing spec: an invite-only room is purely informational (no self-serve action exists), a
 * knock room offers to send the follow request, and a freely-joinable public room offers to
 * follow (join) directly.
 */

// @vitest-environment happy-dom

import { describe, it, expect, vi, afterEach } from "vitest";
import { mkStubRoom, mkEvent, createTestClient } from "test-utils";
import { type MatrixClient, type Room, JoinRule } from "matrix-js-sdk/src/matrix";

import { showActionRequiresFollowModal } from "./SocialEventTile";
import Modal from "../../../../element-web/apps/web/src/Modal";

function roomWithJoinRule(joinRule: string, client: MatrixClient): Room {
    const room = mkStubRoom("!peeked:example.org", "Peeked room", client);
    room.getJoinRule = vi.fn().mockReturnValue(joinRule);
    return room;
}

describe("showActionRequiresFollowModal", () => {
    const client = createTestClient();
    const event = mkEvent({
        event: true,
        type: "m.room.message",
        room: "!peeked:example.org",
        user: "@other:example.org",
        content: { body: "the post" },
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("shows a purely informational 'invite required' modal for an invite-only room", () => {
        const createDialog = vi.spyOn(Modal, "createDialog").mockReturnValue({} as ReturnType<typeof Modal.createDialog>);
        showActionRequiresFollowModal(client, roomWithJoinRule(JoinRule.Invite, client), event, "like");

        const [, props] = createDialog.mock.calls[0]!;
        expect(props).toMatchObject({ title: "Invite required" });
        // No follow/knock action offered - hasCancelButton: false means this is acknowledge-only.
        expect(props).toMatchObject({ hasCancelButton: false });
    });

    it("shows a follow-request modal (not the informational one) for a knock room", () => {
        const createDialog = vi.spyOn(Modal, "createDialog").mockReturnValue({} as ReturnType<typeof Modal.createDialog>);
        showActionRequiresFollowModal(client, roomWithJoinRule(JoinRule.Knock, client), event, "repost");

        const [, props] = createDialog.mock.calls[0]!;
        expect(props).toMatchObject({
            copyOverride: { bodyText: "You must be a follower to repost this post." },
        });
        expect(props).not.toHaveProperty("hasCancelButton");
    });

    it("also treats knock_restricted as a knock room, not invite-only", () => {
        const createDialog = vi.spyOn(Modal, "createDialog").mockReturnValue({} as ReturnType<typeof Modal.createDialog>);
        showActionRequiresFollowModal(client, roomWithJoinRule("knock_restricted", client), event, "reply to");

        const [, props] = createDialog.mock.calls[0]!;
        expect(props).toMatchObject({
            copyOverride: { bodyText: "You must be a follower to reply to this post." },
        });
    });

    it("offers to follow (join) directly for a freely-joinable public room", () => {
        const createDialog = vi.spyOn(Modal, "createDialog").mockReturnValue({} as ReturnType<typeof Modal.createDialog>);
        showActionRequiresFollowModal(client, roomWithJoinRule(JoinRule.Public, client), event, "like");

        const [, props] = createDialog.mock.calls[0]!;
        expect(props).toMatchObject({
            title: "Follow to interact",
            button: "Follow",
        });
    });
});

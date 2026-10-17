/*
 * Social Overlay - ComposerAutocomplete / SocialUserProvider tests
 *
 * Coverage for "@" and "#" completions in Social's plain-textarea composers: what a chosen user or
 * room inserts, and that "@" searches everyone the account shares a room with.
 */

// @vitest-environment happy-dom
// test-utils transitively imports code that calls window.btoa at module load time - see
// social-actions.test.ts's own identical directive.

import { describe, it, expect, beforeEach } from "vitest";
import { EventTimeline, type MatrixClient, Room } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";
import { createTestClient, mkMembership } from "test-utils";

import { type ICompletion } from "../../../../element-web/apps/web/src/autocomplete/Autocompleter";
import { toPlainText } from "./ComposerAutocomplete";
import { collectKnownUsers } from "./SocialUserProvider";

function completion(fields: Partial<ICompletion>): ICompletion {
    return { completion: "", component: {} as ICompletion["component"], range: { start: 0, end: 0 }, ...fields };
}

describe("toPlainText", () => {
    it("inserts a user's Matrix ID, not their display name, followed by a space", () => {
        const c = completion({ type: "user", completion: "Alice", completionId: "@alice:example.org" });
        expect(toPlainText({ ...c, range: { start: 0, end: 3 } }, "@al").completion).toBe("@alice:example.org ");
    });

    it("inserts a room's alias", () => {
        const c = completion({ type: "room", completion: "#haven:example.org", range: { start: 4, end: 6 } });
        expect(toPlainText(c, "see #ha").completion).toBe("#haven:example.org ");
    });

    it("doesn't add a second space when one already follows", () => {
        const c = completion({ type: "user", completionId: "@alice:example.org", range: { start: 0, end: 3 } });
        expect(toPlainText(c, "@al rest").completion).toBe("@alice:example.org");
    });

    it("leaves emoji completions alone", () => {
        const c = completion({ type: undefined, completion: "😀", range: { start: 0, end: 3 } });
        expect(toPlainText(c, ":gr")).toBe(c);
    });
});

describe("collectKnownUsers", () => {
    let client: MatrixClient;

    function mkRoom(roomId: string, members: string[], membership: string = KnownMembership.Join): Room {
        const room = new Room(roomId, client, client.getSafeUserId());
        room.getLiveTimeline().getState(EventTimeline.FORWARDS)!.setStateEvents(
            [client.getSafeUserId(), ...members].map((user) =>
                mkMembership({ event: true, room: roomId, user, mship: KnownMembership.Join }),
            ),
        );
        room.updateMyMembership(membership);
        return room;
    }

    beforeEach(() => {
        client = createTestClient();
    });

    it("lists the composer room's members first, then everyone else from joined rooms, once each", () => {
        const profile = mkRoom("!profile:example.org", ["@follower:example.org"]);
        const other = mkRoom("!other:example.org", ["@friend:example.org", "@follower:example.org"]);
        const left = mkRoom("!left:example.org", ["@stranger:example.org"], KnownMembership.Leave);
        client.getRooms = () => [profile, other, left];

        expect(collectKnownUsers(profile).map((m) => m.userId)).toEqual([
            "@follower:example.org",
            "@friend:example.org",
        ]);
    });
});

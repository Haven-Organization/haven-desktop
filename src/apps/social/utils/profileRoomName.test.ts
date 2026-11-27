// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { type Room } from "matrix-js-sdk/src/matrix";

vi.mock("../../../../element-web/apps/web/src/customisations/Media", () => ({
    mediaFromMxc: (mxc: string) => ({ srcHttp: mxc.replace("mxc://", "https://media.example/") }),
}));
vi.mock("../../../../element-web/apps/web/src/settings/SettingsStore", () => ({ default: { getValue: () => true } }));
vi.mock("../../../../element-web/apps/web/src/MatrixClientPeg", () => ({ MatrixClientPeg: { get: () => null } }));

import { profileRoomNameHtml } from "./profileRoomName";
import { type LiveUserProfile } from "./liveUserProfile";
import { MSC4501_PROFILE_USER_ID_KEY, MSC4501_ROOM_TYPE_PROFILE } from "./room-classifier";

const OWNER = "@cat:example.org";
const ROOM_ID = "!profile:example.org";
const NAME = "Cat :blobcat:";
const FORMATTED = {
    format: "org.matrix.custom.html",
    formatted_body: '<b>Cat</b> <img data-mx-emoticon src="mxc://example.org/abc" alt=":blobcat:">',
};

function makeRoom(opts: {
    name?: string;
    profileUserId?: string | null;
    member?: { membership: string; content: Record<string, unknown> } | null;
}): Room {
    const state: Record<string, Record<string, unknown> | undefined> = {
        "m.room.create": { type: MSC4501_ROOM_TYPE_PROFILE },
        "m.room.name": { name: opts.name ?? NAME },
        [MSC4501_PROFILE_USER_ID_KEY]:
            opts.profileUserId === null ? undefined : { user_id: opts.profileUserId ?? OWNER },
    };
    const member =
        opts.member === null
            ? null
            : {
                  membership: opts.member?.membership ?? "join",
                  events: {
                      member: {
                          getContent: () =>
                              opts.member?.content ?? {
                                  "displayname": NAME,
                                  "org.matrix.msc4589.formatted_displayname": FORMATTED,
                              },
                      },
                  },
              };
    return {
        roomId: ROOM_ID,
        getType: () => MSC4501_ROOM_TYPE_PROFILE,
        currentState: {
            getStateEvents: (type: string) => {
                const content = state[type];
                return content ? { getContent: () => content, getSender: () => OWNER } : null;
            },
        },
        getMember: () => member,
    } as unknown as Room;
}

const linked: LiveUserProfile = {
    displayName: NAME,
    formattedDisplayName: FORMATTED,
    profileRoom: { roomId: ROOM_ID, via: [] },
};

describe("profileRoomNameHtml", () => {
    it("shows the owner's formatted name when everything links up", () => {
        expect(profileRoomNameHtml(makeRoom({}), OWNER, linked)).toContain("<b>Cat</b>");
    });

    it("needs the room's profile_user_id state event to name the owner", () => {
        expect(profileRoomNameHtml(makeRoom({ profileUserId: null }), OWNER, linked)).toBeUndefined();
        expect(profileRoomNameHtml(makeRoom({ profileUserId: "@other:example.org" }), OWNER, linked)).toBeUndefined();
    });

    it("needs the owner's profile to name the room back", () => {
        expect(profileRoomNameHtml(makeRoom({}), OWNER, { ...linked, profileRoom: undefined })).toBeUndefined();
        expect(
            profileRoomNameHtml(makeRoom({}), OWNER, {
                ...linked,
                profileRoom: { roomId: "!other:example.org", via: [] },
            }),
        ).toBeUndefined();
    });

    it("needs the room name to be exactly the owner's display name", () => {
        expect(profileRoomNameHtml(makeRoom({ name: "Cat's page" }), OWNER, linked)).toBeUndefined();
    });

    it("uses the owner's member event in the room over their global profile", () => {
        const room = makeRoom({ member: { membership: "join", content: { displayname: NAME } } });
        expect(profileRoomNameHtml(room, OWNER, linked)).toBeUndefined();
    });

    it("uses the global profile when the owner isn't a member", () => {
        expect(profileRoomNameHtml(makeRoom({ member: null }), OWNER, linked)).toContain("<b>Cat</b>");
    });

    it("shows the plain name for an owner who left or was banned", () => {
        expect(
            profileRoomNameHtml(makeRoom({ member: { membership: "ban", content: {} } }), OWNER, linked),
        ).toBeUndefined();
    });
});

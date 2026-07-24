// @vitest-environment happy-dom
// test-utils (mkStubRoom/mkEvent below) transitively touches browser-only APIs at import time
// (e.g. window.btoa via FileBodyViewModel's icon caching) that the project's default "node"
// environment doesn't provide - matches the environment every other test-utils consumer in this
// codebase already opts into.
import { describe, it, expect, vi } from "vitest";
import { type Room, type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { mkEvent, mkStubRoom } from "test-utils";

import {
    isProfileRoomType,
    isGroupRoomType,
    isSocialPostEventType,
    isProfileRoom,
    isGroupRoom,
    isSocialRoom,
    getSocialRoomType,
    socialRoomKind,
    getVerifiedProfileUserId,
    getProfileOwnerUserId,
    MSC4501_ROOM_TYPE_PROFILE,
    MSC4501_ROOM_TYPE_GROUP,
    MSC4501_EVENT_POST,
    MSC4501_PROFILE_USER_ID_KEY,
} from "./room-classifier";

// mkStubRoom's currentState.getStateEvents is a dumb stub (always [] or null) - this reroutes it to
// answer from a real per-(type, stateKey) map, matching the actual RoomState contract: an array when
// stateKey is omitted, a single event or null when a specific stateKey is given.
function stubState(room: Room, events: Record<string, MatrixEvent>): void {
    vi.mocked(room.currentState).getStateEvents.mockImplementation(((type: string, key?: string) => {
        if (key === undefined) return events[type] ? [events[type]] : [];
        return events[type] ?? null;
    }) as Room["currentState"]["getStateEvents"]);
}

function mkCreateEvent(type: string | undefined, sender = "@creator:example.org"): MatrixEvent {
    return mkEvent({
        event: true,
        type: "m.room.create",
        user: sender,
        room: "!room:example.org",
        skey: "",
        content: type ? { type } : {},
    });
}

describe("room-classifier", () => {
    describe("isProfileRoomType / isGroupRoomType / isSocialPostEventType", () => {
        it("recognizes MSC4501's current names", () => {
            expect(isProfileRoomType(MSC4501_ROOM_TYPE_PROFILE)).toBe(true);
            expect(isGroupRoomType(MSC4501_ROOM_TYPE_GROUP)).toBe(true);
            expect(isSocialPostEventType(MSC4501_EVENT_POST)).toBe(true);
        });

        it("still recognizes MSC3639's older names for backwards compatibility", () => {
            expect(isProfileRoomType("org.matrix.msc3639.social.profile")).toBe(true);
            expect(isGroupRoomType("org.matrix.msc3639.social.group")).toBe(true);
            expect(isSocialPostEventType("org.matrix.msc3639.social.post")).toBe(true);
            expect(isSocialPostEventType("org.matrix.msc3639.social.comment")).toBe(true);
        });

        it("rejects unrelated/undefined types", () => {
            expect(isProfileRoomType(undefined)).toBe(false);
            expect(isProfileRoomType("m.space")).toBe(false);
            expect(isGroupRoomType(MSC4501_ROOM_TYPE_PROFILE)).toBe(false);
            expect(isSocialPostEventType("m.room.message")).toBe(false);
        });
    });

    describe("room-level classification", () => {
        it("classifies a profile room", () => {
            const room = mkStubRoom("!room:example.org");
            stubState(room, { "m.room.create": mkCreateEvent(MSC4501_ROOM_TYPE_PROFILE) });

            expect(isProfileRoom(room)).toBe(true);
            expect(isGroupRoom(room)).toBe(false);
            expect(isSocialRoom(room)).toBe(true);
            expect(getSocialRoomType(room)).toBe(MSC4501_ROOM_TYPE_PROFILE);
            expect(socialRoomKind(room)).toBe("profile");
        });

        it("classifies a group room", () => {
            const room = mkStubRoom("!room:example.org");
            stubState(room, { "m.room.create": mkCreateEvent(MSC4501_ROOM_TYPE_GROUP) });

            expect(isGroupRoom(room)).toBe(true);
            expect(isProfileRoom(room)).toBe(false);
            expect(isSocialRoom(room)).toBe(true);
            expect(getSocialRoomType(room)).toBe(MSC4501_ROOM_TYPE_GROUP);
            expect(socialRoomKind(room)).toBe("group");
        });

        it("normalizes an MSC3639-created profile room to MSC4501's own canonical constant", () => {
            const room = mkStubRoom("!room:example.org");
            stubState(room, { "m.room.create": mkCreateEvent("org.matrix.msc3639.social.profile") });

            expect(getSocialRoomType(room)).toBe(MSC4501_ROOM_TYPE_PROFILE);
        });

        it("classifies a regular (non-social) room", () => {
            const room = mkStubRoom("!room:example.org");
            stubState(room, { "m.room.create": mkCreateEvent(undefined) });

            expect(isProfileRoom(room)).toBe(false);
            expect(isGroupRoom(room)).toBe(false);
            expect(isSocialRoom(room)).toBe(false);
            expect(getSocialRoomType(room)).toBeUndefined();
            expect(socialRoomKind(room)).toBeNull();
        });

        it("classifies a room with no create event at all as non-social, not a crash", () => {
            const room = mkStubRoom("!room:example.org");
            stubState(room, {});

            expect(isSocialRoom(room)).toBe(false);
        });
    });

    describe("getVerifiedProfileUserId", () => {
        it("returns the user_id when present and well-formed", () => {
            const room = mkStubRoom("!room:example.org");
            stubState(room, {
                [MSC4501_PROFILE_USER_ID_KEY]: mkEvent({
                    event: true,
                    type: MSC4501_PROFILE_USER_ID_KEY,
                    user: "@bridge:example.org",
                    room: "!room:example.org",
                    skey: "",
                    content: { user_id: "@owner:example.org" },
                }),
            });

            expect(getVerifiedProfileUserId(room)).toBe("@owner:example.org");
        });

        it("returns undefined when the state event is missing", () => {
            const room = mkStubRoom("!room:example.org");
            stubState(room, {});

            expect(getVerifiedProfileUserId(room)).toBeUndefined();
        });

        it("returns undefined for a malformed (non-mxid-shaped) user_id, rather than showing garbage", () => {
            const room = mkStubRoom("!room:example.org");
            stubState(room, {
                [MSC4501_PROFILE_USER_ID_KEY]: mkEvent({
                    event: true,
                    type: MSC4501_PROFILE_USER_ID_KEY,
                    user: "@bridge:example.org",
                    room: "!room:example.org",
                    skey: "",
                    content: { user_id: "not-a-real-mxid" },
                }),
            });

            expect(getVerifiedProfileUserId(room)).toBeUndefined();
        });
    });

    describe("getProfileOwnerUserId", () => {
        it("prefers the verified profile_user_id over the room creator", () => {
            const room = mkStubRoom("!room:example.org");
            stubState(room, {
                "m.room.create": mkCreateEvent(MSC4501_ROOM_TYPE_PROFILE, "@bridge:example.org"),
                [MSC4501_PROFILE_USER_ID_KEY]: mkEvent({
                    event: true,
                    type: MSC4501_PROFILE_USER_ID_KEY,
                    user: "@bridge:example.org",
                    room: "!room:example.org",
                    skey: "",
                    content: { user_id: "@owner:example.org" },
                }),
            });

            expect(getProfileOwnerUserId(room)).toBe("@owner:example.org");
        });

        it("falls back to the room creator when there's no verified profile_user_id", () => {
            const room = mkStubRoom("!room:example.org");
            stubState(room, {
                "m.room.create": mkCreateEvent(MSC4501_ROOM_TYPE_PROFILE, "@creator:example.org"),
            });

            expect(getProfileOwnerUserId(room)).toBe("@creator:example.org");
        });

        it("returns undefined for a non-profile room", () => {
            const room = mkStubRoom("!room:example.org");
            stubState(room, { "m.room.create": mkCreateEvent(MSC4501_ROOM_TYPE_GROUP, "@creator:example.org") });

            expect(getProfileOwnerUserId(room)).toBeUndefined();
        });
    });
});

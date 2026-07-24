// @vitest-environment happy-dom
// test-utils (mkStubRoom/mkEvent/getMockClientWithEventEmitter below) transitively touches
// browser-only APIs at import time (e.g. window.btoa via FileBodyViewModel's icon caching) that the
// project's default "node" environment doesn't provide.
import { describe, it, expect, vi } from "vitest";
import { type Room, type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { mkEvent, mkStubRoom, getMockClientWithEventEmitter } from "test-utils";

import {
    EMPTY_SOCIAL_FEED_FILTER,
    loadSocialFeedFilter,
    saveSocialFeedFilter,
    getIncludedRoomTypes,
    roomCountsForFeed,
    senderExcludedFromFeed,
    isValidRoomType,
    isValidRoomIdOrAlias,
    isValidUserId,
    SOCIAL_FEED_FILTER_EVENT_TYPE,
    type SocialFeedFilter,
} from "./socialFeedFilter";
import { MSC4501_ROOM_TYPE_PROFILE, MSC4501_ROOM_TYPE_GROUP } from "./room-classifier";

function stubState(room: Room, events: Record<string, MatrixEvent>): void {
    vi.mocked(room.currentState).getStateEvents.mockImplementation(((type: string, key?: string) => {
        if (key === undefined) return events[type] ? [events[type]] : [];
        return events[type] ?? null;
    }) as Room["currentState"]["getStateEvents"]);
}

function mkCreateEvent(type: string | undefined): MatrixEvent {
    return mkEvent({
        event: true,
        type: "m.room.create",
        user: "@creator:example.org",
        room: "!room:example.org",
        skey: "",
        content: type ? { type } : {},
    });
}

describe("socialFeedFilter", () => {
    describe("loadSocialFeedFilter", () => {
        it("returns the empty filter when no account data is set", () => {
            const client = getMockClientWithEventEmitter({ getAccountData: vi.fn().mockReturnValue(undefined) });
            expect(loadSocialFeedFilter(client)).toEqual(EMPTY_SOCIAL_FEED_FILTER);
        });

        it("reads each field from account data content", () => {
            const client = getMockClientWithEventEmitter({
                getAccountData: vi.fn().mockReturnValue({
                    getContent: () => ({
                        extraRoomTypes: ["m.space"],
                        includedRoomIds: ["!a:example.org"],
                        excludedRoomIds: ["!b:example.org"],
                        excludedUserIds: ["@spam:example.org"],
                    }),
                }),
            });

            expect(loadSocialFeedFilter(client)).toEqual({
                extraRoomTypes: ["m.space"],
                includedRoomIds: ["!a:example.org"],
                excludedRoomIds: ["!b:example.org"],
                excludedUserIds: ["@spam:example.org"],
            });
        });

        it("drops non-string entries and tolerates a non-array/missing field, rather than throwing on hand-edited account data", () => {
            const client = getMockClientWithEventEmitter({
                getAccountData: vi.fn().mockReturnValue({
                    getContent: () => ({
                        extraRoomTypes: ["m.space", 42, null],
                        includedRoomIds: "not-an-array",
                        // excludedRoomIds omitted entirely
                        excludedUserIds: ["@spam:example.org"],
                    }),
                }),
            });

            expect(loadSocialFeedFilter(client)).toEqual({
                extraRoomTypes: ["m.space"],
                includedRoomIds: [],
                excludedRoomIds: [],
                excludedUserIds: ["@spam:example.org"],
            });
        });
    });

    it("saveSocialFeedFilter writes the filter to account data under the app's own event type", async () => {
        const setAccountData = vi.fn().mockResolvedValue(undefined);
        const client = getMockClientWithEventEmitter({ setAccountData });
        const filter: SocialFeedFilter = { ...EMPTY_SOCIAL_FEED_FILTER, excludedUserIds: ["@spam:example.org"] };

        await saveSocialFeedFilter(client, filter);

        expect(setAccountData).toHaveBeenCalledWith(SOCIAL_FEED_FILTER_EVENT_TYPE, filter);
    });

    it("getIncludedRoomTypes always includes the two built-in Social room types, plus any filter extras", () => {
        expect(getIncludedRoomTypes(EMPTY_SOCIAL_FEED_FILTER)).toEqual([
            MSC4501_ROOM_TYPE_PROFILE,
            MSC4501_ROOM_TYPE_GROUP,
        ]);
        expect(getIncludedRoomTypes({ ...EMPTY_SOCIAL_FEED_FILTER, extraRoomTypes: ["m.space"] })).toEqual([
            MSC4501_ROOM_TYPE_PROFILE,
            MSC4501_ROOM_TYPE_GROUP,
            "m.space",
        ]);
    });

    describe("roomCountsForFeed", () => {
        it("includes a room by its own built-in social room type with no filter entries at all", () => {
            const room = mkStubRoom("!room:example.org");
            stubState(room, { "m.room.create": mkCreateEvent(MSC4501_ROOM_TYPE_PROFILE) });

            expect(roomCountsForFeed(room, EMPTY_SOCIAL_FEED_FILTER)).toBe(true);
        });

        it("excludes a regular (non-social) room with no filter entries at all", () => {
            const room = mkStubRoom("!room:example.org");
            stubState(room, { "m.room.create": mkCreateEvent(undefined) });

            expect(roomCountsForFeed(room, EMPTY_SOCIAL_FEED_FILTER)).toBe(false);
        });

        it("includes a regular room explicitly listed in includedRoomIds", () => {
            const room = mkStubRoom("!room:example.org");
            stubState(room, { "m.room.create": mkCreateEvent(undefined) });

            const filter = { ...EMPTY_SOCIAL_FEED_FILTER, includedRoomIds: ["!room:example.org"] };
            expect(roomCountsForFeed(room, filter)).toBe(true);
        });

        it("includes a room by its type being listed in extraRoomTypes", () => {
            const room = mkStubRoom("!room:example.org");
            stubState(room, { "m.room.create": mkCreateEvent("m.space") });

            const filter = { ...EMPTY_SOCIAL_FEED_FILTER, extraRoomTypes: ["m.space"] };
            expect(roomCountsForFeed(room, filter)).toBe(true);
        });

        it("matches includedRoomIds/excludedRoomIds against a canonical alias too, not just the room id", () => {
            const room = mkStubRoom("!room:example.org");
            vi.mocked(room.getCanonicalAlias).mockReturnValue("#room:example.org");
            stubState(room, { "m.room.create": mkCreateEvent(undefined) });

            const filter = { ...EMPTY_SOCIAL_FEED_FILTER, includedRoomIds: ["#room:example.org"] };
            expect(roomCountsForFeed(room, filter)).toBe(true);
        });

        it("exclusion always wins over inclusion, even when the same room is listed in both", () => {
            const room = mkStubRoom("!room:example.org");
            stubState(room, { "m.room.create": mkCreateEvent(MSC4501_ROOM_TYPE_PROFILE) });

            const filter = {
                ...EMPTY_SOCIAL_FEED_FILTER,
                includedRoomIds: ["!room:example.org"],
                excludedRoomIds: ["!room:example.org"],
            };
            expect(roomCountsForFeed(room, filter)).toBe(false);
        });

        it("exclusion by type-qualifying room still wins when explicitly excluded by id", () => {
            const room = mkStubRoom("!room:example.org");
            stubState(room, { "m.room.create": mkCreateEvent(MSC4501_ROOM_TYPE_GROUP) });

            const filter = { ...EMPTY_SOCIAL_FEED_FILTER, excludedRoomIds: ["!room:example.org"] };
            expect(roomCountsForFeed(room, filter)).toBe(false);
        });
    });

    describe("senderExcludedFromFeed", () => {
        it("true when the sender is in excludedUserIds", () => {
            const filter = { ...EMPTY_SOCIAL_FEED_FILTER, excludedUserIds: ["@spam:example.org"] };
            expect(senderExcludedFromFeed("@spam:example.org", filter)).toBe(true);
        });

        it("false when the sender isn't excluded", () => {
            const filter = { ...EMPTY_SOCIAL_FEED_FILTER, excludedUserIds: ["@spam:example.org"] };
            expect(senderExcludedFromFeed("@someone-else:example.org", filter)).toBe(false);
        });

        it("false for a null sender, rather than throwing", () => {
            expect(senderExcludedFromFeed(null, EMPTY_SOCIAL_FEED_FILTER)).toBe(false);
        });
    });

    describe("validation helpers", () => {
        it("isValidRoomType rejects whitespace/empty", () => {
            expect(isValidRoomType("m.space")).toBe(true);
            expect(isValidRoomType("")).toBe(false);
            expect(isValidRoomType("has space")).toBe(false);
        });

        it("isValidRoomIdOrAlias accepts room ids and aliases, rejects garbage", () => {
            expect(isValidRoomIdOrAlias("!room:example.org")).toBe(true);
            expect(isValidRoomIdOrAlias("#room:example.org")).toBe(true);
            expect(isValidRoomIdOrAlias("not-a-room-id")).toBe(false);
            expect(isValidRoomIdOrAlias("!room example.org")).toBe(false);
        });

        it("isValidUserId accepts a well-formed mxid, rejects garbage", () => {
            expect(isValidUserId("@user:example.org")).toBe(true);
            expect(isValidUserId("not-a-user-id")).toBe(false);
            expect(isValidUserId("@user example.org")).toBe(false);
        });
    });
});

import { describe, it, expect } from "vitest";
import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";

import { formatMutualRoomCount, getLocalMutualRooms, mutualRoomMatches, pickMutualRoomsIconRoom } from "./MutualRooms";

const userId = "@them:example.com";

function room(
    roomId: string,
    name: string,
    opts: { avatar?: string; alias?: string; theirMembership?: string; space?: boolean; mine?: string } = {},
): Room {
    return {
        roomId,
        name,
        getMxcAvatarUrl: () => opts.avatar ?? null,
        getCanonicalAlias: () => opts.alias ?? null,
        getAltAliases: () => [],
        getMyMembership: () => opts.mine ?? KnownMembership.Join,
        isSpaceRoom: () => !!opts.space,
        getMember: (id: string) =>
            id === userId && opts.theirMembership ? { membership: opts.theirMembership } : null,
    } as unknown as Room;
}

describe("formatMutualRoomCount", () => {
    it("shows counts under 1,000 in full and shortens larger ones", () => {
        expect(formatMutualRoomCount(1)).toBe("1");
        expect(formatMutualRoomCount(999)).toBe("999");
        expect(formatMutualRoomCount(1000)).toBe("1k");
        expect(formatMutualRoomCount(1324)).toBe("1.3k");
        expect(formatMutualRoomCount(1999)).toBe("1.9k");
        expect(formatMutualRoomCount(2_500_000)).toBe("2.5m");
    });
});

describe("pickMutualRoomsIconRoom", () => {
    const current = room("!current:example.com", "A", { avatar: "mxc://a" });
    const plain = room("!plain:example.com", "B");
    const other = room("!other:example.com", "C", { avatar: "mxc://c" });

    it("prefers a room with an avatar other than the current one", () => {
        expect(pickMutualRoomsIconRoom([current, plain, other], current.roomId)).toBe(other);
    });

    it("falls back to the current room when it is the only one with an avatar", () => {
        expect(pickMutualRoomsIconRoom([current, plain], current.roomId)).toBe(current);
    });

    it("returns null when no room has an avatar", () => {
        expect(pickMutualRoomsIconRoom([plain], current.roomId)).toBeNull();
    });
});

describe("mutualRoomMatches", () => {
    const r = room("!abc:example.com", "Dog Park", { alias: "#dogs:example.com" });

    it("matches on name, alias and room ID, ignoring case", () => {
        expect(mutualRoomMatches(r, "dog park")).toBe(true);
        expect(mutualRoomMatches(r, "#DOGS")).toBe(true);
        expect(mutualRoomMatches(r, "!abc")).toBe(true);
        expect(mutualRoomMatches(r, "cats")).toBe(false);
        expect(mutualRoomMatches(r, "  ")).toBe(true);
    });
});

describe("getLocalMutualRooms", () => {
    it("lists joined non-space rooms they are joined to, sorted by name", () => {
        const rooms = [
            room("!z:example.com", "Zebra", { theirMembership: KnownMembership.Join }),
            room("!a:example.com", "Alpha", { theirMembership: KnownMembership.Join }),
            room("!left:example.com", "Left", { theirMembership: KnownMembership.Leave }),
            room("!none:example.com", "Not a member"),
            room("!space:example.com", "Space", { theirMembership: KnownMembership.Join, space: true }),
            room("!invite:example.com", "Invited", {
                theirMembership: KnownMembership.Join,
                mine: KnownMembership.Invite,
            }),
        ];
        const client = { getRooms: () => rooms } as unknown as MatrixClient;

        expect(getLocalMutualRooms(client, userId).map((r) => r.name)).toEqual(["Alpha", "Zebra"]);
    });
});

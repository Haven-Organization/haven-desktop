// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "test-utils-rtl";
import { type MatrixClient, type Room, type RoomMember } from "matrix-js-sdk/src/matrix";

import { usePeopleSearch } from "./usePeopleSearch";
import { useUserDirectory } from "./useUserDirectory";
import { useProfileInfo } from "./useProfileInfo";
import { findVisibleRoomMembers } from "../utils/findVisibleRooms";
import { DirectoryMember } from "../utils/direct-messages";

vi.mock("./useUserDirectory", () => ({ useUserDirectory: vi.fn() }));
vi.mock("./useProfileInfo", () => ({ useProfileInfo: vi.fn() }));
vi.mock("./useSettings", () => ({ useFeatureEnabled: () => false }));
vi.mock("../utils/findVisibleRooms", () => ({
    findVisibleRooms: vi.fn().mockReturnValue([]),
    findVisibleRoomMembers: vi.fn(),
}));
// Spotlight's activity sort needs real rooms; plain name order is enough to test the merging here
vi.mock("../utils/SortMembers", () => ({
    buildActivityScores: () => ({}),
    buildMemberScores: () => ({}),
    compareMembers: () => (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name),
}));

const member = (userId: string, name: string): RoomMember => ({ userId, name }) as unknown as RoomMember;

describe("usePeopleSearch", () => {
    const client = { getUserId: () => "@me:example.com", getRooms: () => [] as Room[] } as unknown as MatrixClient;
    const directorySearch = vi.fn();
    const profileSearch = vi.fn();

    beforeEach(() => {
        vi.mocked(findVisibleRoomMembers).mockReturnValue([
            member("@bob:example.com", "Bob"),
            member("@alice:example.com", "Alice"),
        ]);
        vi.mocked(useUserDirectory).mockReturnValue({
            loading: false,
            users: [new DirectoryMember({ user_id: "@carol:remote.example", display_name: "Carol" })],
            ready: true,
            search: directorySearch,
        });
        vi.mocked(useProfileInfo).mockReturnValue({
            loading: false,
            profile: null,
            ready: true,
            search: profileSearch,
        });
    });

    it("lists everyone you share a room with before searching", () => {
        const { result } = renderHook(() => usePeopleSearch(client, ""));
        expect(result.current.people.map((p) => p.userId)).toEqual(["@alice:example.com", "@bob:example.com"]);
        expect(directorySearch).not.toHaveBeenCalled();
    });

    it("filters room members by name or ID and adds directory and profile results when searching", async () => {
        vi.mocked(useProfileInfo).mockReturnValue({
            loading: false,
            profile: { user_id: "@dave:remote.example", display_name: "Dave" },
            ready: true,
            search: profileSearch,
        });
        const { result } = renderHook(() => usePeopleSearch(client, "bob"));

        expect(result.current.people.map((p) => p.userId)).toEqual([
            "@bob:example.com",
            "@carol:remote.example",
            "@dave:remote.example",
        ]);
        await vi.waitFor(() => expect(directorySearch).toHaveBeenCalledWith({ query: "bob", limit: 20 }));
    });
});

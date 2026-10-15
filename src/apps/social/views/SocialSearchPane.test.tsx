// @vitest-environment happy-dom

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen } from "test-utils-rtl";
import { type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";

import { SocialSearchPane } from "./SocialSearchPane";
import { usePublicRoomDirectory } from "../../../../element-web/apps/web/src/hooks/usePublicRoomDirectory";
import { usePeopleSearch } from "../../../../element-web/apps/web/src/hooks/usePeopleSearch";
import { MSC4501_ROOM_TYPE_GROUP, MSC4501_ROOM_TYPE_PROFILE } from "../utils/room-classifier";

vi.mock("../../../../element-web/apps/web/src/hooks/usePublicRoomDirectory", () => ({ usePublicRoomDirectory: vi.fn() }));
vi.mock("../../../../element-web/apps/web/src/hooks/usePeopleSearch", () => ({ usePeopleSearch: vi.fn() }));
vi.mock("../../../../element-web/apps/web/src/components/views/directory/NetworkDropdown", () => ({
    NetworkDropdown: () => <div>Server picker</div>,
}));
vi.mock("../components/SocialPersonRow", () => ({
    SocialPersonRow: ({ member }: { member: { userId: string } }) => <div>person {member.userId}</div>,
}));
vi.mock("../components/GroupTile", () => ({
    DirectoryGroupTile: ({ entry, onView }: { entry: { room_id: string; name: string }; onView: (e: unknown) => void }) => (
        <button onClick={() => onView(entry)}>group {entry.name}</button>
    ),
}));
vi.mock("../utils/thread-relations", () => ({ replyCountFor: () => 0 }));
vi.mock("../components/SocialEventTile", () => ({
    SocialEventTile: ({ event, highlights }: { event: MatrixEvent; highlights: string[] }) => (
        <div>
            post {event.getId()} [{highlights.join(",")}]
        </div>
    ),
}));

describe("<SocialSearchPane />", () => {
    const search = vi.fn();
    const onViewDirectoryGroup = vi.fn();
    const socialRoom = {
        roomId: "!group:example.com",
        getMyMembership: () => KnownMembership.Join,
        currentState: { getStateEvents: () => ({ getContent: () => ({ type: MSC4501_ROOM_TYPE_GROUP }) }) },
        relations: { getChildEventsForEvent: () => undefined },
        getThread: () => null,
        findEventById: () => undefined,
    } as unknown as Room;
    let client: MatrixClient;

    beforeEach(() => {
        vi.clearAllMocks();
        const event = {
            getId: () => "$post",
            getRoomId: () => socialRoom.roomId,
            getWireContent: () => ({}),
            isRelation: () => false,
        } as unknown as MatrixEvent;
        client = {
            getRooms: () => [socialRoom],
            getRoom: (id: string) => (id === socialRoom.roomId ? socialRoom : null),
            getSafeUserId: () => "@me:example.com",
            search: vi.fn().mockResolvedValue({}),
            processRoomEventsSearch: vi.fn().mockReturnValue({
                results: [{ context: { getEvent: () => event } }],
                highlights: ["zoomies"],
            }),
        } as unknown as MatrixClient;
        vi.mocked(usePeopleSearch).mockReturnValue({ people: [{ userId: "@bob:example.com" } as any], loading: false });
        vi.mocked(usePublicRoomDirectory).mockReturnValue({
            ready: true,
            loading: false,
            publicRooms: [
                { room_id: "!g1:remote.example", name: "Dogs", room_type: MSC4501_ROOM_TYPE_GROUP, num_joined_members: 3 },
                { room_id: "!p1:remote.example", name: "Someone", room_type: MSC4501_ROOM_TYPE_PROFILE, num_joined_members: 1 },
            ] as any,
            protocols: {},
            config: { roomServer: "remote.example" },
            setConfig: vi.fn(),
            search,
        });
    });

    const renderPane = () =>
        render(
            <SocialSearchPane
                client={client}
                pillsGeneration={0}
                onViewUser={vi.fn()}
                onOpenUserPanel={vi.fn()}
                onViewRoom={vi.fn()}
                onViewDirectoryGroup={onViewDirectoryGroup}
                onOpenPost={vi.fn()}
                onNavigateToProfile={vi.fn()}
            />,
        );

    const type = (value: string) => fireEvent.change(screen.getByRole("searchbox"), { target: { value } });

    it("shows the People tab first, listing people", () => {
        renderPane();
        type("");
        fireEvent.click(screen.getByRole("tab", { name: "People" }));
        expect(screen.getByRole("tab", { name: "People", selected: true })).toBeInTheDocument();
        expect(screen.getByText("person @bob:example.com")).toBeInTheDocument();
    });

    it("lists only groups from the directory, asking the server for the group room type", async () => {
        renderPane();
        type("");
        fireEvent.click(screen.getByRole("tab", { name: "Groups" }));

        expect(screen.getByText("Server picker")).toBeInTheDocument();
        await vi.waitFor(() =>
            expect(search).toHaveBeenCalledWith({
                limit: 100,
                query: undefined,
                roomTypes: new Set([MSC4501_ROOM_TYPE_GROUP]),
            }),
        );
        expect(screen.queryByText("group Someone")).not.toBeInTheDocument();

        fireEvent.click(screen.getByText("group Dogs"));
        expect(onViewDirectoryGroup).toHaveBeenCalledWith("!g1:remote.example", ["remote.example"]);
    });

    it("prompts for a search on the Posts tab, then searches Social rooms by relevance", async () => {
        renderPane();
        type("");
        fireEvent.click(screen.getByRole("tab", { name: "Posts" }));
        expect(screen.getByText("Search for posts using the search box above.")).toBeInTheDocument();

        type("zoomies");
        expect(await screen.findByText("post $post [zoomies]")).toBeInTheDocument();
        const body = vi.mocked(client.search).mock.calls[0][0].body as any;
        expect(body.search_categories.room_events).toMatchObject({
            search_term: "zoomies",
            order_by: "rank",
            filter: { rooms: [socialRoom.roomId] },
        });
    });
});

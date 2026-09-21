/*
Copyright 2024 New Vector Ltd.
Copyright 2023 Mikhail Aheichyk
Copyright 2023 Nordeck IT + Consulting GmbH.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import React, { type JSX } from "react";
import { cleanup, queryByRole, render, screen, within } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import { type Room } from "matrix-js-sdk/src/matrix";

import LegacyRoomList from "./LegacyRoomList";
import ResizeNotifier from "../../utils/ResizeNotifier";
import { MetaSpace } from "../../stores/spaces";
import { shouldShowComponent } from "../../customisations/helpers/UIComponents";
import { UIComponent } from "../../settings/UIFeature";
import dis from "../../dispatcher/dispatcher";
import { Action } from "../../dispatcher/actions";
import * as testUtils from "test-utils";
import { mkSpace, stubClient } from "test-utils";
import { MatrixClientPeg } from "../../MatrixClientPeg";
import { SDKContextClass } from "../../contexts/SDKContextClass";
import DMRoomMap from "../../utils/DMRoomMap";
import RoomListStore from "../stores/RoomListStore";
import { type ITagMap } from "../stores/algorithms/models";
import { DefaultTagID } from "../../stores/room-list-v3/skip-list/tag";

vi.mock("../../customisations/helpers/UIComponents", () => ({
    shouldShowComponent: vi.fn(),
}));

vi.mock("../../dispatcher/dispatcher");

const getUserIdForRoomId = vi.fn();
const getDMRoomsForUserId = vi.fn();
// @ts-ignore
DMRoomMap.sharedInstance = { getUserIdForRoomId, getDMRoomsForUserId };

describe("LegacyRoomList", () => {
    stubClient();
    const client = MatrixClientPeg.safeGet();
    const store = SDKContextClass.instance.spaceStore;

    function getComponent(props: Partial<LegacyRoomList["props"]> = {}): JSX.Element {
        return (
            <LegacyRoomList
                onKeyDown={vi.fn()}
                onFocus={vi.fn()}
                onBlur={vi.fn()}
                onResize={vi.fn()}
                resizeNotifier={new ResizeNotifier()}
                isMinimized={false}
                activeSpace={MetaSpace.Home}
                {...props}
            />
        );
    }

    describe("Rooms", () => {
        describe("when meta space is active", () => {
            beforeEach(() => {
                store.setActiveSpace(MetaSpace.Home);
            });

            it("does not render add room button when UIComponent customisation disables CreateRooms and ExploreRooms", () => {
                const disabled: UIComponent[] = [UIComponent.CreateRooms, UIComponent.ExploreRooms];
                vi.mocked(shouldShowComponent).mockImplementation((feature) => !disabled.includes(feature));
                render(getComponent());

                const roomsList = screen.getByRole("group", { name: "Rooms" });
                expect(within(roomsList).queryByRole("button", { name: "Add room" })).not.toBeInTheDocument();
            });

            it("renders add room button with menu when UIComponent customisation allows CreateRooms or ExploreRooms", async () => {
                let disabled: UIComponent[] = [];
                vi.mocked(shouldShowComponent).mockImplementation((feature) => !disabled.includes(feature));
                const { rerender } = render(getComponent());

                const roomsList = screen.getByRole("group", { name: "Rooms" });
                const addRoomButton = within(roomsList).getByRole("button", { name: "Add room" });
                expect(screen.queryByRole("menu")).not.toBeInTheDocument();

                await userEvent.click(addRoomButton);

                const menu = screen.getByRole("menu");

                expect(within(menu).getByRole("menuitem", { name: "New room" })).toBeInTheDocument();
                expect(within(menu).getByRole("menuitem", { name: "Explore public rooms" })).toBeInTheDocument();

                disabled = [UIComponent.CreateRooms];
                rerender(getComponent());

                expect(addRoomButton).toBeInTheDocument();
                expect(menu).toBeInTheDocument();
                expect(within(menu).queryByRole("menuitem", { name: "New room" })).not.toBeInTheDocument();
                expect(within(menu).getByRole("menuitem", { name: "Explore public rooms" })).toBeInTheDocument();

                disabled = [UIComponent.ExploreRooms];
                rerender(getComponent());

                expect(addRoomButton).toBeInTheDocument();
                expect(menu).toBeInTheDocument();
                expect(within(menu).getByRole("menuitem", { name: "New room" })).toBeInTheDocument();
                expect(within(menu).queryByRole("menuitem", { name: "Explore public rooms" })).not.toBeInTheDocument();
            });

            it("renders add room button and clicks explore public rooms", async () => {
                vi.mocked(shouldShowComponent).mockReturnValue(true);
                render(getComponent());

                const roomsList = screen.getByRole("group", { name: "Rooms" });
                await userEvent.click(within(roomsList).getByRole("button", { name: "Add room" }));

                const menu = screen.getByRole("menu");
                await userEvent.click(within(menu).getByRole("menuitem", { name: "Explore public rooms" }));

                expect(dis.fire).toHaveBeenCalledWith(Action.ViewRoomDirectory);
            });
        });

        describe("when room space is active", () => {
            let rooms: Room[];
            const mkSpaceForRooms = (spaceId: string, children: string[] = []) =>
                mkSpace(client, spaceId, rooms, children);

            const space1 = "!space1:server";

            beforeEach(async () => {
                rooms = [];
                mkSpaceForRooms(space1);
                vi.mocked(client).getRoom.mockImplementation(
                    (roomId) => rooms.find((room) => room.roomId === roomId) || null,
                );
                await testUtils.setupAsyncStoreWithClient(store, client);

                store.setActiveSpace(space1);
            });

            it("does not render add room button when UIComponent customisation disables CreateRooms and ExploreRooms", () => {
                const disabled: UIComponent[] = [UIComponent.CreateRooms, UIComponent.ExploreRooms];
                vi.mocked(shouldShowComponent).mockImplementation((feature) => !disabled.includes(feature));
                render(getComponent());

                const roomsList = screen.getByRole("group", { name: "Rooms" });
                expect(within(roomsList).queryByRole("button", { name: "Add room" })).not.toBeInTheDocument();
            });

            it("renders add room button with menu when UIComponent customisation allows CreateRooms or ExploreRooms", async () => {
                let disabled: UIComponent[] = [];
                vi.mocked(shouldShowComponent).mockImplementation((feature) => !disabled.includes(feature));
                const { rerender } = render(getComponent());

                const roomsList = screen.getByRole("group", { name: "Rooms" });
                const addRoomButton = within(roomsList).getByRole("button", { name: "Add room" });
                expect(screen.queryByRole("menu")).not.toBeInTheDocument();

                await userEvent.click(addRoomButton);

                const menu = screen.getByRole("menu");

                expect(within(menu).getByRole("menuitem", { name: "Explore rooms" })).toBeInTheDocument();
                expect(within(menu).getByRole("menuitem", { name: "New room" })).toBeInTheDocument();
                expect(within(menu).getByRole("menuitem", { name: "Add existing room" })).toBeInTheDocument();

                disabled = [UIComponent.CreateRooms];
                rerender(getComponent());

                expect(addRoomButton).toBeInTheDocument();
                expect(menu).toBeInTheDocument();
                expect(within(menu).getByRole("menuitem", { name: "Explore rooms" })).toBeInTheDocument();
                expect(within(menu).queryByRole("menuitem", { name: "New room" })).not.toBeInTheDocument();
                expect(within(menu).queryByRole("menuitem", { name: "Add existing room" })).not.toBeInTheDocument();

                disabled = [UIComponent.ExploreRooms];
                rerender(getComponent());

                expect(addRoomButton).toBeInTheDocument();
                expect(menu).toBeInTheDocument();
                expect(within(menu).queryByRole("menuitem", { name: "Explore rooms" })).toBeInTheDocument();
                expect(within(menu).getByRole("menuitem", { name: "New room" })).toBeInTheDocument();
                expect(within(menu).getByRole("menuitem", { name: "Add existing room" })).toBeInTheDocument();
            });

            it("renders add room button and clicks explore rooms", async () => {
                vi.mocked(shouldShowComponent).mockReturnValue(true);
                render(getComponent());

                const roomsList = screen.getByRole("group", { name: "Rooms" });
                await userEvent.click(within(roomsList).getByRole("button", { name: "Add room" }));

                const menu = screen.getByRole("menu");
                await userEvent.click(within(menu).getByRole("menuitem", { name: "Explore rooms" }));

                expect(dis.dispatch).toHaveBeenCalledWith({
                    action: Action.ViewRoom,
                    room_id: space1,
                });
            });
        });

        describe("when video meta space is active", () => {
            const videoRoomPrivate = "!videoRoomPrivate_server";
            const videoRoomPublic = "!videoRoomPublic_server";
            const videoRoomKnock = "!videoRoomKnock_server";

            beforeEach(async () => {
                cleanup();
                const rooms: Room[] = [];
                testUtils.mkRoom(client, videoRoomPrivate, rooms);
                testUtils.mkRoom(client, videoRoomPublic, rooms);
                testUtils.mkRoom(client, videoRoomKnock, rooms);

                vi.mocked(client).getRoom.mockImplementation(
                    (roomId) => rooms.find((room) => room.roomId === roomId) || null,
                );
                vi.mocked(client).getRooms.mockImplementation(() => rooms);

                const videoRoomKnockRoom = client.getRoom(videoRoomKnock)!;
                const videoRoomPrivateRoom = client.getRoom(videoRoomPrivate)!;
                const videoRoomPublicRoom = client.getRoom(videoRoomPublic)!;

                [videoRoomPrivateRoom, videoRoomPublicRoom, videoRoomKnockRoom].forEach((room) => {
                    (room.isCallRoom as Mock).mockReturnValue(true);
                });

                const roomLists: ITagMap = {};
                roomLists[DefaultTagID.Conference] = [videoRoomKnockRoom, videoRoomPublicRoom];
                roomLists[DefaultTagID.Untagged] = [videoRoomPrivateRoom];
                vi.spyOn(RoomListStore.instance, "orderedLists", "get").mockReturnValue(roomLists);
                await testUtils.setupAsyncStoreWithClient(store, client);

                store.setActiveSpace(MetaSpace.VideoRooms);
            });

            it("renders Conferences and Room but no People section", () => {
                const renderResult = render(getComponent({ activeSpace: MetaSpace.VideoRooms }));
                const roomsEl = renderResult.getByRole("treeitem", { name: "Rooms" });
                const conferenceEl = renderResult.getByRole("treeitem", { name: "Conferences" });

                const noInvites = screen.queryByRole("treeitem", { name: "Invites" });
                const noFavourites = screen.queryByRole("treeitem", { name: "Favourites" });
                const noPeople = screen.queryByRole("treeitem", { name: "People" });
                const noLowPriority = screen.queryByRole("treeitem", { name: "Low priority" });
                const noHistorical = screen.queryByRole("treeitem", { name: "Historical" });

                expect(roomsEl).toBeVisible();
                expect(conferenceEl).toBeVisible();

                expect(noInvites).toBeFalsy();
                expect(noFavourites).toBeFalsy();
                expect(noPeople).toBeFalsy();
                expect(noLowPriority).toBeFalsy();
                expect(noHistorical).toBeFalsy();
            });
            it("renders Public and Knock rooms in Conferences section", () => {
                const renderResult = render(getComponent({ activeSpace: MetaSpace.VideoRooms }));
                const conferenceList = renderResult.getByRole("group", { name: "Conferences" });
                expect(queryByRole(conferenceList, "treeitem", { name: videoRoomPublic })).toBeVisible();
                expect(queryByRole(conferenceList, "treeitem", { name: videoRoomKnock })).toBeVisible();
                expect(queryByRole(conferenceList, "treeitem", { name: videoRoomPrivate })).toBeFalsy();

                const roomsList = renderResult.getByRole("group", { name: "Rooms" });
                expect(queryByRole(roomsList, "treeitem", { name: videoRoomPrivate })).toBeVisible();
                expect(queryByRole(roomsList, "treeitem", { name: videoRoomPublic })).toBeFalsy();
                expect(queryByRole(roomsList, "treeitem", { name: videoRoomKnock })).toBeFalsy();
            });
        });
    });
});

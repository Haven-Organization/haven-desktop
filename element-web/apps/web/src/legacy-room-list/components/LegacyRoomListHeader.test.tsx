/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { type MatrixClient, type Room, EventType } from "matrix-js-sdk/src/matrix";
import { act, render, screen, fireEvent, type RenderResult } from "test-utils-rtl";

import { SDKContextClass } from "../../contexts/SDKContextClass";
import { MetaSpace } from "../../stores/spaces";
import _RoomListHeader from "./LegacyRoomListHeader";
import * as testUtils from "test-utils";
import { stubClient, mkSpace } from "test-utils";
import DMRoomMap from "../../utils/DMRoomMap";
import { MatrixClientPeg } from "../../MatrixClientPeg";
import SettingsStore from "../../settings/SettingsStore";
import { SettingLevel } from "../../settings/SettingLevel";
import { shouldShowComponent } from "../../customisations/helpers/UIComponents";
import { UIComponent } from "../../settings/UIFeature";

const RoomListHeader = testUtils.wrapInMatrixClientContext(_RoomListHeader);

vi.mock("../../customisations/helpers/UIComponents", () => ({
    shouldShowComponent: vi.fn(),
}));

// vitest.config.ts always resolves the "legacy-room-list" specifier to the stub (LEGACY_ROOM_LIST_AVAILABLE false).
// SpaceStore only offers the Favourites/People meta spaces while the legacy room list is available and switched on
// (see its metaSpaceOrder), so this test - which imports the real header by relative path - needs it to report that
// it is available.
vi.mock("legacy-room-list", async (importOriginal) => ({
    ...(await importOriginal<typeof import("legacy-room-list")>()),
    LEGACY_ROOM_LIST_AVAILABLE: true,
}));

const blockUIComponent = (component: UIComponent): void => {
    vi.mocked(shouldShowComponent).mockImplementation((feature) => feature !== component);
};

const setupSpace = (client: MatrixClient): Room => {
    const testSpace: Room = mkSpace(client, "!space:server");
    testSpace.name = "Test Space";
    client.getRoom = () => testSpace;
    return testSpace;
};

const setupMainMenu = async (client: MatrixClient, testSpace: Room): Promise<RenderResult> => {
    await testUtils.setupAsyncStoreWithClient(SDKContextClass.instance.spaceStore, client);
    act(() => {
        SDKContextClass.instance.spaceStore.setActiveSpace(testSpace.roomId);
    });

    const wrapper = render(<RoomListHeader />);

    expect(wrapper.getByText("Test Space")).toBeInTheDocument();
    wrapper.getByLabelText("Test Space menu").click();

    return wrapper;
};

const setupPlusMenu = async (client: MatrixClient, testSpace: Room): Promise<RenderResult> => {
    await testUtils.setupAsyncStoreWithClient(SDKContextClass.instance.spaceStore, client);
    act(() => {
        SDKContextClass.instance.spaceStore.setActiveSpace(testSpace.roomId);
    });

    const wrapper = render(<RoomListHeader />);

    expect(wrapper.getByText("Test Space")).toBeInTheDocument();
    act(() => {
        wrapper.getByLabelText("Add")?.click();
    });

    return wrapper;
};

const checkIsDisabled = (menuItem: HTMLElement): void => {
    expect(menuItem).toHaveAttribute("disabled");
    expect(menuItem).toHaveAttribute("aria-disabled", "true");
};

const checkMenuLabels = (items: NodeListOf<Element>, labelArray: Array<string>) => {
    expect(items).toHaveLength(labelArray.length);

    const checkLabel = (item: Element, label: string) => {
        expect(item.querySelector(".mx_IconizedContextMenu_label")).toHaveTextContent(label);
    };

    labelArray.forEach((label, index) => {
        console.log("index", index, "label", label);
        checkLabel(items[index], label);
    });
};

describe("RoomListHeader", () => {
    let client: MatrixClient;

    beforeEach(async () => {
        // This tests the header from the old room list/left panel, the new one is now enabled by default,
        // so the old list needs to be explicitly opted into here.
        await SettingsStore.setValue("Haven.useOldRoomList", null, SettingLevel.DEVICE, true);
        vi.resetAllMocks();

        const dmRoomMap = {
            getUserIdForRoomId: vi.fn(),
            getDMRoomsForUserId: vi.fn(),
        } as unknown as DMRoomMap;
        DMRoomMap.setShared(dmRoomMap);
        stubClient();
        client = MatrixClientPeg.safeGet();
        vi.mocked(shouldShowComponent).mockReturnValue(true); // show all UIComponents
    });

    it("renders a main menu for the home space", () => {
        act(() => {
            SDKContextClass.instance.spaceStore.setActiveSpace(MetaSpace.Home);
        });

        const { container } = render(<RoomListHeader />);

        expect(container).toHaveTextContent("Home");
        fireEvent.click(screen.getByLabelText("Home options"));

        const menu = screen.getByRole("menu");
        const items = menu.querySelectorAll(".mx_IconizedContextMenu_item");
        expect(items).toHaveLength(1);
        expect(items[0]).toHaveTextContent("Show all rooms");
    });

    it("renders a main menu for spaces", async () => {
        const testSpace = setupSpace(client);
        await setupMainMenu(client, testSpace);

        const menu = screen.getByRole("menu");
        const items = menu.querySelectorAll(".mx_IconizedContextMenu_item");

        checkMenuLabels(items, ["Space home", "Manage & explore rooms", "Preferences", "Settings", "Room", "Space"]);
    });

    it("renders a plus menu for spaces", async () => {
        const testSpace = setupSpace(client);
        await setupPlusMenu(client, testSpace);

        const menu = screen.getByRole("menu");
        const items = menu.querySelectorAll(".mx_IconizedContextMenu_item");

        checkMenuLabels(items, ["New room", "Explore rooms", "Add existing room", "Add space"]);
    });

    it("closes menu if space changes from under it", async () => {
        await SettingsStore.setValue("Spaces.enabledMetaSpaces", null, SettingLevel.DEVICE, {
            [MetaSpace.Home]: true,
            [MetaSpace.Favourites]: true,
        });

        const testSpace = setupSpace(client);
        await setupMainMenu(client, testSpace);

        act(() => {
            SDKContextClass.instance.spaceStore.setActiveSpace(MetaSpace.Favourites);
        });

        screen.getByText("Favorites");
        expect(screen.queryByRole("menu")).toBeFalsy();
    });

    describe("UIComponents", () => {
        describe("Main menu", () => {
            it("does not render Add Space when user does not have permission to add spaces", async () => {
                // User does not have permission to add spaces, anywhere
                blockUIComponent(UIComponent.CreateSpaces);

                const testSpace = setupSpace(client);
                await setupMainMenu(client, testSpace);

                const menu = screen.getByRole("menu");
                const items = menu.querySelectorAll(".mx_IconizedContextMenu_item");
                checkMenuLabels(items, [
                    "Space home",
                    "Manage & explore rooms",
                    "Preferences",
                    "Settings",
                    "Room",
                    // no add space
                ]);
            });

            it("does not render Add Room when user does not have permission to add rooms", async () => {
                // User does not have permission to add rooms
                blockUIComponent(UIComponent.CreateRooms);

                const testSpace = setupSpace(client);
                await setupMainMenu(client, testSpace);

                const menu = screen.getByRole("menu");
                const items = menu.querySelectorAll(".mx_IconizedContextMenu_item");
                checkMenuLabels(items, [
                    "Space home",
                    "Explore rooms", // not Manage & explore rooms
                    "Preferences",
                    "Settings",
                    // no add room
                    "Space",
                ]);
            });
        });

        describe("Plus menu", () => {
            it("does not render Add Space when user does not have permission to add spaces", async () => {
                // User does not have permission to add spaces, anywhere
                blockUIComponent(UIComponent.CreateSpaces);

                const testSpace = setupSpace(client);
                await setupPlusMenu(client, testSpace);

                const menu = screen.getByRole("menu");
                const items = menu.querySelectorAll(".mx_IconizedContextMenu_item");

                checkMenuLabels(items, [
                    "New room",
                    "Explore rooms",
                    "Add existing room",
                    // no Add space
                ]);
            });

            it("disables Add Room when user does not have permission to add rooms", async () => {
                // User does not have permission to add rooms
                blockUIComponent(UIComponent.CreateRooms);

                const testSpace = setupSpace(client);
                await setupPlusMenu(client, testSpace);

                const menu = screen.getByRole("menu");
                const items = menu.querySelectorAll<HTMLElement>(".mx_IconizedContextMenu_item");

                checkMenuLabels(items, ["New room", "Explore rooms", "Add existing room", "Add space"]);

                // "Add existing room" is disabled
                checkIsDisabled(items[2]);
            });
        });
    });

    describe("adding children to space", () => {
        it("if user cannot add children to space, MainMenu adding buttons are hidden", async () => {
            const testSpace = setupSpace(client);
            vi.mocked(testSpace.currentState.maySendStateEvent).mockImplementation(
                (stateEventType, userId) => stateEventType !== EventType.SpaceChild,
            );

            await setupMainMenu(client, testSpace);

            const menu = screen.getByRole("menu");
            const items = menu.querySelectorAll(".mx_IconizedContextMenu_item");
            checkMenuLabels(items, [
                "Space home",
                "Explore rooms", // not Manage & explore rooms
                "Preferences",
                "Settings",
                // no add room
                // no add space
            ]);
        });

        it("if user cannot add children to space, PlusMenu add buttons are disabled", async () => {
            const testSpace = setupSpace(client);
            vi.mocked(testSpace.currentState.maySendStateEvent).mockImplementation(
                (stateEventType, userId) => stateEventType !== EventType.SpaceChild,
            );

            await setupPlusMenu(client, testSpace);

            const menu = screen.getByRole("menu");
            const items = menu.querySelectorAll<HTMLElement>(".mx_IconizedContextMenu_item");

            checkMenuLabels(items, ["New room", "Explore rooms", "Add existing room", "Add space"]);

            // "Add existing room" is disabled
            checkIsDisabled(items[2]);
            // "Add space" is disabled
            checkIsDisabled(items[3]);
        });
    });
});

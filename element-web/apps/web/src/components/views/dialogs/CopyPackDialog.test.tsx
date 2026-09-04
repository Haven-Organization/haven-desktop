/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import { stubClient, mkStubRoom } from "test-utils";

import CopyPackDialog from "./CopyPackDialog";
import * as ImagePacks from "../../../utils/ImagePacks";
import * as sortRoomsByRecency from "../../../utils/room/sortRoomsByRecency";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import DMRoomMap from "../../../utils/DMRoomMap";

vi.mock("../../../dispatcher/dispatcher");

const PACK = {
    roomId: "!source:example.org",
    stateKey: "packA",
    content: {
        pack: { display_name: "My Pack" },
        images: { one: {}, two: {} },
    },
} as unknown as ImagePacks.RoomImagePack;

// Haven: MSC2545's "Copy pack" dialog - modeled on ForwardDialog.tsx's own room list/search/roving-
// tabindex/per-row action-state UI, but with the pack itself shown as a preview instead of a message,
// and the room list filtered down to only rooms the user can add packs to (canManageImagePacks).
describe("CopyPackDialog", () => {
    let client: ReturnType<typeof stubClient>;

    beforeEach(() => {
        client = stubClient();
        DMRoomMap.makeShared(client);
        vi.spyOn(ImagePacks, "packDisplayName").mockImplementation((_content, fallback) => fallback);
        vi.spyOn(ImagePacks, "getPackAvatarMxc").mockReturnValue(undefined);
        vi.spyOn(sortRoomsByRecency, "sortRoomsByRecency").mockImplementation((rooms) => rooms);

        const sourceRoom = mkStubRoom("!source:example.org", "Source Room", client);
        client.getRoom = vi.fn((id: string) => (id === "!source:example.org" ? sourceRoom : null));
    });

    it("shows the pack's name and image count as a preview", () => {
        client.getVisibleRooms = vi.fn().mockReturnValue([]);

        render(<CopyPackDialog matrixClient={client} pack={PACK} onFinished={vi.fn()} />);

        expect(screen.getByText("packA")).toBeInTheDocument();
        expect(screen.getByText("2 images")).toBeInTheDocument();
    });

    it("shows a placeholder message when there are no rooms the user can add packs to", () => {
        const notManageable = mkStubRoom("!nope:example.org", "No Perms Room", client);
        vi.spyOn(ImagePacks, "canManageImagePacks").mockReturnValue(false);
        client.getVisibleRooms = vi.fn().mockReturnValue([notManageable]);

        render(<CopyPackDialog matrixClient={client} pack={PACK} onFinished={vi.fn()} />);

        expect(
            screen.getByText("You don't have permission to add packs to any of your rooms."),
        ).toBeInTheDocument();
        expect(screen.queryByPlaceholderText("Search for rooms or people")).not.toBeInTheDocument();
    });

    it("only lists rooms the user has permission to add packs to", () => {
        const canRoom = mkStubRoom("!can:example.org", "Can Manage Room", client);
        const cannotRoom = mkStubRoom("!cannot:example.org", "Cannot Manage Room", client);
        vi.spyOn(ImagePacks, "canManageImagePacks").mockImplementation((room) => room.roomId === "!can:example.org");
        client.getVisibleRooms = vi.fn().mockReturnValue([canRoom, cannotRoom]);

        render(<CopyPackDialog matrixClient={client} pack={PACK} onFinished={vi.fn()} />);

        expect(screen.getByText("Can Manage Room")).toBeInTheDocument();
        expect(screen.queryByText("Cannot Manage Room")).not.toBeInTheDocument();
    });

    it("excludes space rooms and rooms the user isn't joined to, even if manageable", () => {
        const space = mkStubRoom("!space:example.org", "A Space", client);
        space.isSpaceRoom = vi.fn().mockReturnValue(true);
        const invited = mkStubRoom("!invited:example.org", "Invited Room", client);
        invited.getMyMembership = vi.fn().mockReturnValue("invite");
        vi.spyOn(ImagePacks, "canManageImagePacks").mockReturnValue(true);
        client.getVisibleRooms = vi.fn().mockReturnValue([space, invited]);

        render(<CopyPackDialog matrixClient={client} pack={PACK} onFinished={vi.fn()} />);

        expect(screen.queryByText("A Space")).not.toBeInTheDocument();
        expect(screen.queryByText("Invited Room")).not.toBeInTheDocument();
        expect(
            screen.getByText("You don't have permission to add packs to any of your rooms."),
        ).toBeInTheDocument();
    });

    it("falls back to the generic no-results message when a search matches nothing", async () => {
        const room = mkStubRoom("!can:example.org", "Can Manage Room", client);
        vi.spyOn(ImagePacks, "canManageImagePacks").mockReturnValue(true);
        client.getVisibleRooms = vi.fn().mockReturnValue([room]);

        render(<CopyPackDialog matrixClient={client} pack={PACK} onFinished={vi.fn()} />);
        // Haven: SearchBox throttles its onSearch callback (leading+trailing, 200ms) - wait for
        // the trailing call carrying the full typed query to actually land.
        await userEvent.type(screen.getByPlaceholderText("Search for rooms or people"), "no such room");

        await waitFor(() => expect(screen.getByText("No results")).toBeInTheDocument());
        expect(screen.queryByText("Can Manage Room")).not.toBeInTheDocument();
    });

    it("copies the pack into a room, transitioning the button through Copying to Copied", async () => {
        const room = mkStubRoom("!can:example.org", "Can Manage Room", client);
        vi.spyOn(ImagePacks, "canManageImagePacks").mockReturnValue(true);
        client.getVisibleRooms = vi.fn().mockReturnValue([room]);
        let resolveCopy: () => void = () => {};
        const copySpy = vi
            .spyOn(ImagePacks, "copyImagePackToRoom")
            .mockImplementation(() => new Promise((resolve) => (resolveCopy = () => resolve(undefined))));

        render(<CopyPackDialog matrixClient={client} pack={PACK} onFinished={vi.fn()} />);
        await userEvent.click(screen.getByRole("button", { name: "Copy" }));

        expect(copySpy).toHaveBeenCalledWith(client, PACK, room);
        expect(await screen.findByRole("button", { name: "Sending" })).toBeInTheDocument();

        resolveCopy();
        expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    });

    it("jumps to a room and closes the dialog when its name is clicked", async () => {
        const room = mkStubRoom("!can:example.org", "Can Manage Room", client);
        vi.spyOn(ImagePacks, "canManageImagePacks").mockReturnValue(true);
        client.getVisibleRooms = vi.fn().mockReturnValue([room]);
        const onFinished = vi.fn();

        render(<CopyPackDialog matrixClient={client} pack={PACK} onFinished={onFinished} />);
        await userEvent.click(screen.getByText("Can Manage Room"));

        expect(dis.dispatch).toHaveBeenCalledWith(
            expect.objectContaining({ action: Action.ViewRoom, room_id: "!can:example.org" }),
        );
        expect(onFinished).toHaveBeenCalledWith(true);
    });

    // Haven: without this, jumping to a room from Copy Pack (opened from inside room/user settings)
    // left the settings dialog stacked on top of the room the user just navigated to.
    it("also closes the enclosing settings dialog when a room's name is clicked", async () => {
        const room = mkStubRoom("!can:example.org", "Can Manage Room", client);
        vi.spyOn(ImagePacks, "canManageImagePacks").mockReturnValue(true);
        client.getVisibleRooms = vi.fn().mockReturnValue([room]);
        const closeSettingsFn = vi.fn();

        render(
            <CopyPackDialog
                matrixClient={client}
                pack={PACK}
                closeSettingsFn={closeSettingsFn}
                onFinished={vi.fn()}
            />,
        );
        await userEvent.click(screen.getByText("Can Manage Room"));

        expect(closeSettingsFn).toHaveBeenCalled();
    });
});

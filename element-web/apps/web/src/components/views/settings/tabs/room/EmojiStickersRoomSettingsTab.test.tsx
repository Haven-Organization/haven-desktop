/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import { stubClient, mkStubRoom } from "test-utils";

import EmojiStickersRoomSettingsTab from "./EmojiStickersRoomSettingsTab";
import * as ImagePacks from "../../../../../utils/ImagePacks";
import * as pendingManagePack from "../../../../../utils/pendingManagePack";
import * as useRoomStateHook from "../../../../../hooks/useRoomState";
import Modal from "../../../../../Modal";
import CopyPackDialog from "../../../dialogs/CopyPackDialog";

vi.mock("../../emojistickers/PackEditor", () => ({
    PackEditor: (props: any) => <div data-testid="pack-editor">{props.pack.stateKey}</div>,
    PackAvatar: () => <div data-testid="pack-avatar" />,
}));
vi.mock("../../../../../Modal");

function makePack(stateKey: string, imageCount = 0): ImagePacks.RoomImagePack {
    const images: Record<string, unknown> = {};
    for (let i = 0; i < imageCount; i++) images[`img${i}`] = {};
    return {
        roomId: "!room:example.org",
        stateKey,
        content: { pack: { display_name: stateKey }, images },
    } as unknown as ImagePacks.RoomImagePack;
}

// Haven: MSC2545's room settings "Emoji & Stickers" tab - the pack list/create/delete UI, and the
// pendingManagePack hand-off from the emoji picker's own manage-gear click that should open
// straight into a specific pack's editor rather than the list. useRoomState is mocked directly
// (rather than driving real room-state events through a stub Room) since it's a well-defined hook
// boundary and this component's own logic is what's under test here, not the hook itself.
describe("EmojiStickersRoomSettingsTab", () => {
    let client: ReturnType<typeof stubClient>;

    beforeEach(() => {
        vi.restoreAllMocks();
        client = stubClient();
        vi.spyOn(pendingManagePack, "consumePendingManagePackStateKey").mockReturnValue(null);
        vi.spyOn(ImagePacks, "getPackAvatarMxc").mockReturnValue(undefined);
        vi.spyOn(ImagePacks, "packDisplayName").mockImplementation((_content, fallback) => fallback);
    });

    // Haven: rather than guessing call order, let useRoomState just invoke whatever mapper it's
    // given - each mapper closes over a real (mocked-below) ImagePacks function, so mocking those
    // directly is what actually controls the packs/canManage values here. getRoomImagePacksForManagement
    // reads the given array live on every render (not a snapshot), so a test can mutate it in place
    // to simulate a pack appearing after a save.
    function mockRoomState(packs: ImagePacks.RoomImagePack[], canManage: boolean): void {
        vi.spyOn(useRoomStateHook, "useRoomState").mockImplementation((_room, mapper: any) => mapper());
        vi.spyOn(ImagePacks, "getRoomImagePacksForManagement").mockImplementation(() => packs);
        vi.spyOn(ImagePacks, "canManageImagePacks").mockReturnValue(canManage);
    }

    it("shows the empty-state message when the room has no packs", () => {
        const room = mkStubRoom("!room:example.org", "Room", client);
        room.isSpaceRoom = vi.fn().mockReturnValue(false);
        mockRoomState([], true);

        render(<EmojiStickersRoomSettingsTab room={room} />);

        expect(screen.getByText("This room has no emoji or sticker packs yet.")).toBeInTheDocument();
    });

    it("shows a space-specific empty-state message for a space room", () => {
        const room = mkStubRoom("!room:example.org", "Space", client);
        room.isSpaceRoom = vi.fn().mockReturnValue(true);
        mockRoomState([], true);

        render(<EmojiStickersRoomSettingsTab room={room} />);

        expect(screen.getByText("This space has no emoji or sticker packs yet.")).toBeInTheDocument();
    });

    it("lists existing packs with their image counts and hides create/delete controls when the viewer can't manage", () => {
        const room = mkStubRoom("!room:example.org", "Room", client);
        room.isSpaceRoom = vi.fn().mockReturnValue(false);
        mockRoomState([makePack("packA", 3)], false);

        render(<EmojiStickersRoomSettingsTab room={room} />);

        expect(screen.getByText("packA")).toBeInTheDocument();
        expect(screen.getByText("3 images")).toBeInTheDocument();
        expect(screen.queryByRole("textbox", { name: "Pack name" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    });

    it("creates a new pack and opens its editor", async () => {
        const room = mkStubRoom("!room:example.org", "Room", client);
        room.isSpaceRoom = vi.fn().mockReturnValue(false);
        const packs: ImagePacks.RoomImagePack[] = [];
        mockRoomState(packs, true);
        vi.spyOn(ImagePacks, "newPackStateKey").mockReturnValue("newpack");
        const saveSpy = vi.spyOn(ImagePacks, "saveRoomImagePack").mockImplementation(async () => {
            packs.push(makePack("newpack"));
        });

        render(<EmojiStickersRoomSettingsTab room={room} />);

        await userEvent.type(screen.getByRole("textbox", { name: "Pack name" }), "My New Pack");
        await userEvent.click(screen.getByRole("button", { name: "Create" }));

        expect(saveSpy).toHaveBeenCalledWith(
            client,
            room.roomId,
            "newpack",
            expect.objectContaining({ pack: { display_name: "My New Pack" }, images: {} }),
        );
        expect(await screen.findByTestId("pack-editor")).toHaveTextContent("newpack");
    });

    it("deletes a pack by saving it empty", async () => {
        const room = mkStubRoom("!room:example.org", "Room", client);
        room.isSpaceRoom = vi.fn().mockReturnValue(false);
        mockRoomState([makePack("packA", 1)], true);
        const deleteSpy = vi.spyOn(ImagePacks, "deleteRoomImagePack").mockResolvedValue(undefined as never);

        render(<EmojiStickersRoomSettingsTab room={room} />);

        await userEvent.click(screen.getByRole("button", { name: "Remove" }));

        expect(deleteSpy).toHaveBeenCalledWith(client, room.roomId, "packA");
    });

    it("opens the copy dialog for a pack when its Copy button is clicked", async () => {
        const room = mkStubRoom("!room:example.org", "Room", client);
        room.isSpaceRoom = vi.fn().mockReturnValue(false);
        const pack = makePack("packA", 1);
        mockRoomState([pack], true);

        render(<EmojiStickersRoomSettingsTab room={room} />);

        await userEvent.click(screen.getByRole("button", { name: "Copy" }));

        expect(Modal.createDialog).toHaveBeenCalledWith(
            CopyPackDialog,
            { matrixClient: client, pack },
            "mx_CopyPackDialog_wrapper",
        );
    });

    it("opens straight into a pending pack's editor when the emoji picker's manage gear queued one", () => {
        const room = mkStubRoom("!room:example.org", "Room", client);
        room.isSpaceRoom = vi.fn().mockReturnValue(false);
        mockRoomState([makePack("packA"), makePack("packB")], true);
        vi.spyOn(pendingManagePack, "consumePendingManagePackStateKey").mockReturnValue("packB");

        render(<EmojiStickersRoomSettingsTab room={room} />);

        expect(screen.getByTestId("pack-editor")).toHaveTextContent("packB");
    });
});

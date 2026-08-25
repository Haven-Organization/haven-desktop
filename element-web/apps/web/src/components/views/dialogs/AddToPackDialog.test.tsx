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
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { stubClient, mkStubRoom, mkEvent } from "test-utils";

import AddToPackDialog from "./AddToPackDialog";
import * as ImagePacks from "../../../utils/ImagePacks";

const PACK_A = { roomId: "!a:example.org", stateKey: "packA", content: { images: {} } } as unknown as ImagePacks.RoomImagePack;
const PACK_B = { roomId: "!b:example.org", stateKey: "packB", content: { images: {} } } as unknown as ImagePacks.RoomImagePack;

// Haven: MSC2545's "Add to Pack" dialog - one-click add of a message's image to any pack the user
// can manage, with search-by-pack-or-room-name filtering. Covers the search filter, the disabled-
// until-packable-image guard, the busy/error states of the add flow, and the empty-list message.
describe("AddToPackDialog", () => {
    let client: ReturnType<typeof stubClient>;
    let mxEvent: MatrixEvent;

    beforeEach(() => {
        client = stubClient();
        mxEvent = mkEvent({ event: true, type: "m.room.message", room: "!a:example.org", user: "@alice:example.org", content: {} });
        vi.spyOn(ImagePacks, "packDisplayName").mockImplementation((_content, fallback) => fallback);
        vi.spyOn(ImagePacks, "getPackAvatarMxc").mockReturnValue(undefined);
        vi.spyOn(ImagePacks, "getPackableImageFromEvent").mockReturnValue({ mxcUrl: "mxc://example.org/img", body: "cool.png" });
        vi.spyOn(ImagePacks, "addPackImageFromMxcUrl").mockResolvedValue({ mxcUrl: "mxc://example.org/img", info: {} } as never);
        vi.spyOn(ImagePacks, "addImageToExistingPack").mockResolvedValue(undefined as never);

        const roomA = mkStubRoom("!a:example.org", "Room A", client);
        const roomB = mkStubRoom("!b:example.org", "Room B", client);
        client.getRoom = vi.fn((id: string) => (id === "!a:example.org" ? roomA : id === "!b:example.org" ? roomB : null));
    });

    it("shows the empty-state message when there are no manageable packs", () => {
        vi.spyOn(ImagePacks, "getManageableImagePacks").mockReturnValue([]);
        render(<AddToPackDialog mxEvent={mxEvent} onFinished={vi.fn()} />);

        expect(screen.getByText("No packs to add to - create one in a room's settings first.")).toBeInTheDocument();
    });

    it("lists every manageable pack with its source room", () => {
        vi.spyOn(ImagePacks, "getManageableImagePacks").mockReturnValue([PACK_A, PACK_B]);
        render(<AddToPackDialog mxEvent={mxEvent} onFinished={vi.fn()} />);

        expect(screen.getByText("packA")).toBeInTheDocument();
        expect(screen.getByText("Room A")).toBeInTheDocument();
        expect(screen.getByText("packB")).toBeInTheDocument();
        expect(screen.getByText("Room B")).toBeInTheDocument();
    });

    it("filters packs by pack name or room name", async () => {
        vi.spyOn(ImagePacks, "getManageableImagePacks").mockReturnValue([PACK_A, PACK_B]);
        render(<AddToPackDialog mxEvent={mxEvent} onFinished={vi.fn()} />);

        await userEvent.type(screen.getByLabelText("Search packs or rooms"), "Room B");

        expect(screen.queryByText("packA")).not.toBeInTheDocument();
        expect(screen.getByText("packB")).toBeInTheDocument();
    });

    it("adds the event's image to the chosen pack and finishes with added=true", async () => {
        vi.spyOn(ImagePacks, "getManageableImagePacks").mockReturnValue([PACK_A]);
        const onFinished = vi.fn();
        render(<AddToPackDialog mxEvent={mxEvent} onFinished={onFinished} />);

        await userEvent.click(screen.getByRole("button", { name: "Add" }));

        expect(ImagePacks.addPackImageFromMxcUrl).toHaveBeenCalledWith(client, "mxc://example.org/img");
        expect(ImagePacks.addImageToExistingPack).toHaveBeenCalledWith(
            client,
            PACK_A.roomId,
            PACK_A.stateKey,
            expect.objectContaining({ shortcodeHint: "cool.png", url: "mxc://example.org/img" }),
        );
        expect(onFinished).toHaveBeenCalledWith(true);
    });

    it("disables the Add button and shows nothing to add when the event has no packable image", () => {
        vi.spyOn(ImagePacks, "getManageableImagePacks").mockReturnValue([PACK_A]);
        vi.spyOn(ImagePacks, "getPackableImageFromEvent").mockReturnValue(undefined);
        render(<AddToPackDialog mxEvent={mxEvent} onFinished={vi.fn()} />);

        expect(screen.getByRole("button", { name: "Add" })).toHaveAttribute("aria-disabled", "true");
    });

    it("shows an error message and re-enables adding when the add fails", async () => {
        vi.spyOn(ImagePacks, "getManageableImagePacks").mockReturnValue([PACK_A]);
        vi.spyOn(ImagePacks, "addPackImageFromMxcUrl").mockRejectedValue(new Error("upload failed"));
        const onFinished = vi.fn();
        render(<AddToPackDialog mxEvent={mxEvent} onFinished={onFinished} />);

        await userEvent.click(screen.getByRole("button", { name: "Add" }));

        expect(screen.getByText("upload failed")).toBeInTheDocument();
        expect(onFinished).not.toHaveBeenCalled();
        expect(screen.getByRole("button", { name: "Add" })).not.toHaveAttribute("aria-disabled", "true");
    });
});

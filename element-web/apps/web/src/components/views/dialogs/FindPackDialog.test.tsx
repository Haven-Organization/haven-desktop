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

import FindPackDialog from "./FindPackDialog";
import * as ImagePacks from "../../../utils/ImagePacks";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";

vi.mock("../../../dispatcher/dispatcher");
vi.mock("../settings/emojistickers/PackEditor", () => ({
    PackEditor: () => <div data-testid="pack-editor" />,
    PackAvatar: () => <div data-testid="pack-avatar" />,
}));

const PACK_REF = { room_id: "!pack-room:example.org", state_key: "mypack", via: ["example.org"], shortcode: "mypack" };

// Haven: MSC4459's "find pack" dialog has three distinct states depending on whether the
// referenced room is joined and whether the pack is still there (packs can't truly be deleted in
// Matrix, only emptied) - each needs its own coverage, plus the favorite toggle this dialog also
// exposes once the pack is found.
describe("FindPackDialog", () => {
    let client: ReturnType<typeof stubClient>;

    beforeEach(() => {
        client = stubClient();
        vi.spyOn(ImagePacks, "isPackFavorited").mockReturnValue(false);
        vi.spyOn(ImagePacks, "getFavoritePackRefs").mockReturnValue([]);
        vi.spyOn(ImagePacks, "setFavoritePackRefs").mockResolvedValue(undefined);
    });

    it("offers to preview the room when it isn't joined", async () => {
        client.getRoom = vi.fn().mockReturnValue(null);
        const onFinished = vi.fn();
        render(<FindPackDialog packRef={PACK_REF} onFinished={onFinished} />);

        expect(screen.getByText("You haven't joined this pack's room yet.")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Preview Room" }));

        expect(dis.dispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                action: Action.ViewRoom,
                room_id: PACK_REF.room_id,
                should_peek: true,
            }),
        );
        expect(onFinished).toHaveBeenCalled();
    });

    it("shows a 'pack is gone' message when the room is joined but the pack is empty", () => {
        const room = mkStubRoom(PACK_REF.room_id, "Pack Room", client);
        client.getRoom = vi.fn().mockReturnValue(room);
        vi.spyOn(ImagePacks, "getRoomImagePacks").mockReturnValue([]);

        render(<FindPackDialog packRef={PACK_REF} onFinished={vi.fn()} />);

        expect(screen.getByText("This pack no longer exists.")).toBeInTheDocument();
    });

    it("shows the pack row with view/favorite actions when the pack exists", async () => {
        const room = mkStubRoom(PACK_REF.room_id, "Pack Room", client);
        client.getRoom = vi.fn().mockReturnValue(room);
        const pack = { roomId: PACK_REF.room_id, stateKey: "mypack", content: { images: {} } } as unknown as ImagePacks.RoomImagePack;
        vi.spyOn(ImagePacks, "getRoomImagePacks").mockReturnValue([pack]);
        vi.spyOn(ImagePacks, "packDisplayName").mockReturnValue("My Pack");
        vi.spyOn(ImagePacks, "getPackAvatarMxc").mockReturnValue(undefined);
        vi.spyOn(ImagePacks, "canManageImagePacks").mockReturnValue(true);

        render(<FindPackDialog packRef={PACK_REF} onFinished={vi.fn()} />);

        expect(screen.getByText("My Pack")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Favorite" })).toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", { name: "View" }));
        expect(screen.getByTestId("pack-editor")).toBeInTheDocument();
    });

    it("toggles favorite state on click", async () => {
        const room = mkStubRoom(PACK_REF.room_id, "Pack Room", client);
        client.getRoom = vi.fn().mockReturnValue(room);
        const pack = { roomId: PACK_REF.room_id, stateKey: "mypack", content: { images: {} } } as unknown as ImagePacks.RoomImagePack;
        vi.spyOn(ImagePacks, "getRoomImagePacks").mockReturnValue([pack]);
        vi.spyOn(ImagePacks, "packDisplayName").mockReturnValue("My Pack");
        vi.spyOn(ImagePacks, "getPackAvatarMxc").mockReturnValue(undefined);

        render(<FindPackDialog packRef={PACK_REF} onFinished={vi.fn()} />);

        await userEvent.click(screen.getByRole("button", { name: "Favorite" }));

        expect(ImagePacks.setFavoritePackRefs).toHaveBeenCalledWith(client, [
            { roomId: PACK_REF.room_id, stateKey: PACK_REF.state_key },
        ]);
    });
});

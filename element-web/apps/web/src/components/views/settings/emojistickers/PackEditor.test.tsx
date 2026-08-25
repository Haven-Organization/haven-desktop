/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import { stubClient, mkStubRoom } from "test-utils";

import { PackEditor } from "./PackEditor";
import * as ImagePacks from "../../../../utils/ImagePacks";

function makePack(): ImagePacks.RoomImagePack {
    return {
        roomId: "!room:example.org",
        stateKey: "packA",
        content: {
            pack: { display_name: "My Pack" },
            images: {
                existing: { url: "mxc://example.org/existing", body: "existing" },
            },
        },
    } as unknown as ImagePacks.RoomImagePack;
}

// Haven: MSC2545's pack "View"/edit sub-page, shared by the room and user settings "Emoji &
// Stickers" tabs. Covers adding an image by mxc:// URL, editing/removing a draft image, the
// dirty-gated Save flow, the search filter with its own empty-state, and the read-only (canManage
// false) affordances: editing controls stay visible-but-disabled while add/remove/save disappear.
describe("PackEditor", () => {
    let client: ReturnType<typeof stubClient>;

    beforeEach(() => {
        vi.restoreAllMocks();
        client = stubClient();
        vi.spyOn(ImagePacks, "getPackAvatarMxc").mockReturnValue(undefined);
        vi.spyOn(ImagePacks, "effectiveImageUsage").mockReturnValue(["emoticon", "sticker"]);
        vi.spyOn(ImagePacks, "shortcodeFromMxcUrl").mockImplementation((url) => url.split("/").pop() ?? "image");
        vi.spyOn(ImagePacks, "sanitizeShortcode").mockImplementation((s) => s);
    });

    it("calls onBack when the back button is clicked", async () => {
        const room = mkStubRoom("!room:example.org", "Room", client);
        const onBack = vi.fn();
        render(<PackEditor room={room} pack={makePack()} canManage={true} onBack={onBack} />);

        await userEvent.click(screen.getByRole("button", { name: "← Back" }));

        expect(onBack).toHaveBeenCalled();
    });

    it("adds an image from an mxc:// URL and enables Save", async () => {
        const room = mkStubRoom("!room:example.org", "Room", client);
        vi.spyOn(ImagePacks, "addPackImageFromMxcUrl").mockResolvedValue({ mxcUrl: "mxc://example.org/new", info: {} } as never);

        render(<PackEditor room={room} pack={makePack()} canManage={true} onBack={vi.fn()} />);

        expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("aria-disabled", "true");

        await userEvent.type(screen.getByRole("textbox", { name: "mxc:// URL" }), "mxc://example.org/new");
        await userEvent.click(screen.getByRole("button", { name: "Add" }));

        expect(ImagePacks.addPackImageFromMxcUrl).toHaveBeenCalledWith(client, "mxc://example.org/new");
        expect(screen.getByText(":new:")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Save" })).not.toHaveAttribute("aria-disabled", "true");
    });

    it("shows an error and leaves Save disabled when adding by mxc:// URL fails", async () => {
        const room = mkStubRoom("!room:example.org", "Room", client);
        vi.spyOn(ImagePacks, "addPackImageFromMxcUrl").mockRejectedValue(new Error("bad url"));

        render(<PackEditor room={room} pack={makePack()} canManage={true} onBack={vi.fn()} />);

        await userEvent.type(screen.getByRole("textbox", { name: "mxc:// URL" }), "mxc://bad");
        await userEvent.click(screen.getByRole("button", { name: "Add" }));

        expect(screen.getByText("bad url")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("aria-disabled", "true");
    });

    it("edits an image's shortcode via its row's Edit/Done toggle", async () => {
        const room = mkStubRoom("!room:example.org", "Room", client);
        render(<PackEditor room={room} pack={makePack()} canManage={true} onBack={vi.fn()} />);

        const row = screen.getByText(":existing:").closest(".mx_EmojiStickersSettingsTab_imageRow") as HTMLElement;
        await userEvent.click(within(row).getByRole("button", { name: "Edit" }));
        const shortcodeField = screen.getByRole("textbox", { name: "Shortcode" });
        await userEvent.clear(shortcodeField);
        await userEvent.type(shortcodeField, "renamed");
        await userEvent.click(screen.getByRole("button", { name: "Done" }));

        expect(screen.getByText(":renamed:")).toBeInTheDocument();
    });

    it("removes an image and marks the pack dirty", async () => {
        const room = mkStubRoom("!room:example.org", "Room", client);
        render(<PackEditor room={room} pack={makePack()} canManage={true} onBack={vi.fn()} />);

        expect(screen.getByText(":existing:")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Remove" }));

        expect(screen.queryByText(":existing:")).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Save" })).not.toHaveAttribute("aria-disabled", "true");
    });

    it("saves the pack with the current display name, usage, and images keyed by shortcode", async () => {
        const room = mkStubRoom("!room:example.org", "Room", client);
        const saveSpy = vi.spyOn(ImagePacks, "saveRoomImagePack").mockResolvedValue(undefined as never);
        render(<PackEditor room={room} pack={makePack()} canManage={true} onBack={vi.fn()} />);

        await userEvent.click(screen.getByRole("button", { name: "Remove" }));
        await userEvent.click(screen.getByRole("button", { name: "Save" }));

        expect(saveSpy).toHaveBeenCalledWith(
            client,
            room.roomId,
            "packA",
            expect.objectContaining({
                pack: expect.objectContaining({ display_name: "My Pack" }),
                images: {},
            }),
        );
    });

    it("filters images by shortcode or description, with an empty-state message", async () => {
        const room = mkStubRoom("!room:example.org", "Room", client);
        const pack = makePack();
        pack.content.images = {
            apple: { url: "mxc://example.org/apple", body: "a fruit" },
            banana: { url: "mxc://example.org/banana", body: "yellow" },
        };
        render(<PackEditor room={room} pack={pack} canManage={true} onBack={vi.fn()} />);

        await userEvent.type(screen.getByRole("textbox", { name: "Search images" }), "yellow");

        expect(screen.queryByText(":apple:")).not.toBeInTheDocument();
        expect(screen.getByText(":banana:")).toBeInTheDocument();

        await userEvent.clear(screen.getByRole("textbox", { name: "Search images" }));
        await userEvent.type(screen.getByRole("textbox", { name: "Search images" }), "nomatch");

        expect(screen.getByText("No images match your search.")).toBeInTheDocument();
    });

    it("hides add/remove/save controls and disables editing when the viewer can't manage the pack", () => {
        const room = mkStubRoom("!room:example.org", "Room", client);
        render(<PackEditor room={room} pack={makePack()} canManage={false} onBack={vi.fn()} />);

        expect(screen.queryByRole("textbox", { name: "mxc:// URL" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
        const row = screen.getByText(":existing:").closest(".mx_EmojiStickersSettingsTab_imageRow") as HTMLElement;
        expect(within(row).getByRole("button", { name: "Edit" })).toHaveAttribute("aria-disabled", "true");
    });
});

/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "test-utils-rtl";
import { act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { stubClient, mkStubRoom } from "test-utils";

import { PackEditor } from "./PackEditor";
import * as ImagePacks from "../../../../utils/ImagePacks";
import Modal from "../../../../Modal";
import QuestionDialog from "../../dialogs/QuestionDialog";
import { SettingsNavigationGuardContext } from "../../../../contexts/SettingsNavigationGuardContext";

vi.mock("../../../../Modal");

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
        // Haven: vi.restoreAllMocks() only restores vi.spyOn() mocks to their real implementation -
        // Modal.createDialog is auto-mocked via vi.mock("../../../../Modal") at the top of this
        // file, so its call history has to be cleared explicitly or it accumulates across every
        // test in this file.
        vi.mocked(Modal.createDialog).mockClear();
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

        expect(screen.getByRole("button", { name: "Save Changes" })).toHaveAttribute("aria-disabled", "true");

        await userEvent.type(screen.getByRole("textbox", { name: "mxc:// URL" }), "mxc://example.org/new");
        await userEvent.click(screen.getByRole("button", { name: "Add" }));

        expect(ImagePacks.addPackImageFromMxcUrl).toHaveBeenCalledWith(client, "mxc://example.org/new");
        expect(screen.getByText(":new:")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Save Changes" })).not.toHaveAttribute("aria-disabled", "true");
    });

    it("shows an error and leaves Save disabled when adding by mxc:// URL fails", async () => {
        const room = mkStubRoom("!room:example.org", "Room", client);
        vi.spyOn(ImagePacks, "addPackImageFromMxcUrl").mockRejectedValue(new Error("bad url"));

        render(<PackEditor room={room} pack={makePack()} canManage={true} onBack={vi.fn()} />);

        await userEvent.type(screen.getByRole("textbox", { name: "mxc:// URL" }), "mxc://bad");
        await userEvent.click(screen.getByRole("button", { name: "Add" }));

        expect(screen.getByText("bad url")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Save Changes" })).toHaveAttribute("aria-disabled", "true");
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
        expect(screen.getByRole("button", { name: "Save Changes" })).not.toHaveAttribute("aria-disabled", "true");
    });

    it("saves the pack with the current display name, usage, and images keyed by shortcode", async () => {
        const room = mkStubRoom("!room:example.org", "Room", client);
        const saveSpy = vi.spyOn(ImagePacks, "saveRoomImagePack").mockResolvedValue(undefined as never);
        render(<PackEditor room={room} pack={makePack()} canManage={true} onBack={vi.fn()} />);

        await userEvent.click(screen.getByRole("button", { name: "Remove" }));
        await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));

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
        expect(screen.queryByRole("button", { name: "Save Changes" })).not.toBeInTheDocument();
        const row = screen.getByText(":existing:").closest(".mx_EmojiStickersSettingsTab_imageRow") as HTMLElement;
        expect(within(row).getByRole("button", { name: "Edit" })).toHaveAttribute("aria-disabled", "true");
    });

    // Haven: requirement 1/3 - the pack name is editable in place (no separate top-level Edit mode
    // to enter first). Leaving the field with an actual change in place (switching focus away from
    // it) marks the whole pack dirty right away - there's no separate confirm step for this field,
    // unlike the earlier checkmark-based design - and still only touches the local draft, not the
    // server.
    it("renaming the pack and switching focus away marks it dirty without touching the server", async () => {
        const room = mkStubRoom("!room:example.org", "Room", client);
        const saveSpy = vi.spyOn(ImagePacks, "saveRoomImagePack").mockResolvedValue(undefined as never);
        render(<PackEditor room={room} pack={makePack()} canManage={true} onBack={vi.fn()} />);

        expect(screen.queryByText("You have unsaved changes.")).not.toBeInTheDocument();

        const nameField = screen.getByRole("textbox", { name: "Pack name" });
        await userEvent.clear(nameField);
        await userEvent.type(nameField, "Renamed Pack");
        await userEvent.tab();

        expect(saveSpy).not.toHaveBeenCalled();
        expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Save Changes" })).not.toHaveAttribute("aria-disabled", "true");
        expect(screen.getByRole("button", { name: "Discard Changes" })).toBeInTheDocument();
    });

    // Haven: requirements 6/7 - Discard Changes reverts every local edit back to the pack's own
    // saved content and clears the dirty/unsaved-changes affordances.
    it("Discard Changes reverts the renamed pack and clears the dirty state", async () => {
        const room = mkStubRoom("!room:example.org", "Room", client);
        render(<PackEditor room={room} pack={makePack()} canManage={true} onBack={vi.fn()} />);

        const nameField = screen.getByRole("textbox", { name: "Pack name" });
        await userEvent.clear(nameField);
        await userEvent.type(nameField, "Renamed Pack");
        await userEvent.tab();
        expect(screen.getByRole("textbox", { name: "Pack name" })).toHaveValue("Renamed Pack");

        await userEvent.click(screen.getByRole("button", { name: "Discard Changes" }));

        expect(screen.getByRole("textbox", { name: "Pack name" })).toHaveValue("My Pack");
        expect(screen.queryByText("You have unsaved changes.")).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Save Changes" })).toHaveAttribute("aria-disabled", "true");
    });

    // Haven: bug history on this field - it used to be Compound's EditInPlace with a checkmark to
    // confirm, whose show/hide was driven by internal focus tracking (flickered on its own Cancel,
    // and hid once you clicked away from the field even with an unconfirmed edit still pending).
    // There's no checkmark at all any more: only Cancel, shown purely because the typed name
    // differs from the pack's own saved name (so nothing here is focus-dependent), and switching
    // focus away from the field with an actual change in place commits it immediately.
    describe("pack name field", () => {
        it("shows no Cancel button until the name actually differs from the saved one", async () => {
            const room = mkStubRoom("!room:example.org", "Room", client);
            render(<PackEditor room={room} pack={makePack()} canManage={true} onBack={vi.fn()} />);

            expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();

            const nameField = screen.getByRole("textbox", { name: "Pack name" });
            await userEvent.type(nameField, " 2");

            expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
        });

        it("commits the edit and marks the pack dirty as soon as focus leaves the field", async () => {
            const room = mkStubRoom("!room:example.org", "Room", client);
            render(<PackEditor room={room} pack={makePack()} canManage={true} onBack={vi.fn()} />);

            const nameField = screen.getByRole("textbox", { name: "Pack name" });
            await userEvent.type(nameField, " 2");
            expect(screen.getByRole("button", { name: "Save Changes" })).toHaveAttribute("aria-disabled", "true");

            // Switch focus elsewhere entirely unrelated to the name field.
            await userEvent.click(screen.getByRole("combobox", { name: "Images usage" }));

            expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "Save Changes" })).not.toHaveAttribute("aria-disabled", "true");
            // Cancel stays up - it's still meaningful to revert just this field even after the
            // whole pack has been marked dirty by it.
            expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
        });

        it("does not mark the pack dirty when focus leaves the field without any actual change", async () => {
            const room = mkStubRoom("!room:example.org", "Room", client);
            render(<PackEditor room={room} pack={makePack()} canManage={true} onBack={vi.fn()} />);

            const nameField = screen.getByRole("textbox", { name: "Pack name" });
            await userEvent.click(nameField);
            await userEvent.tab();

            expect(screen.queryByText("You have unsaved changes.")).not.toBeInTheDocument();
            expect(screen.getByRole("button", { name: "Save Changes" })).toHaveAttribute("aria-disabled", "true");
        });

        it("Cancel reverts the name and hides itself cleanly, in one step", async () => {
            const room = mkStubRoom("!room:example.org", "Room", client);
            render(<PackEditor room={room} pack={makePack()} canManage={true} onBack={vi.fn()} />);

            const nameField = screen.getByRole("textbox", { name: "Pack name" });
            await userEvent.type(nameField, " 2");

            await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

            expect(nameField).toHaveValue("My Pack");
            expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
        });

        // Haven: bug report - `dirty` used to be a one-way flag various handlers set with no way
        // to un-set it short of a full Discard Changes, so canceling the only actual edit left the
        // pack looking dirty forever (the "Unsaved changes" dialog would still have popped up
        // trying to leave, and Save Changes would have stayed enabled, despite nothing having
        // actually changed from the server). It's derived now (see PackEditor's own `dirty`
        // computation), so this - already blur-committed, then explicitly canceled - correctly
        // clears every trace of it.
        it("clears the whole pack's dirty state once the only unsaved edit is canceled after being committed", async () => {
            const room = mkStubRoom("!room:example.org", "Room", client);
            render(<PackEditor room={room} pack={makePack()} canManage={true} onBack={vi.fn()} />);

            const nameField = screen.getByRole("textbox", { name: "Pack name" });
            await userEvent.type(nameField, " 2");
            await userEvent.tab();
            expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "Save Changes" })).not.toHaveAttribute("aria-disabled", "true");

            await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

            expect(nameField).toHaveValue("My Pack");
            expect(screen.queryByText("You have unsaved changes.")).not.toBeInTheDocument();
            expect(screen.queryByRole("button", { name: "Discard Changes" })).not.toBeInTheDocument();
            expect(screen.getByRole("button", { name: "Save Changes" })).toHaveAttribute("aria-disabled", "true");
        });
    });

    // Haven: helper for mocking one Modal.createDialog(QuestionDialog, ...) round trip - returns a
    // resolver the test calls with `[goBack]` to simulate the user's choice, matching what
    // QuestionDialog's own onFinished(ok?: boolean) resolves the real `finished` promise with.
    function mockNextQuestionDialog(): (goBack: boolean | undefined) => Promise<void> {
        let resolveFinished: ((value: [boolean | undefined]) => void) | undefined;
        vi.mocked(Modal.createDialog).mockReturnValueOnce({
            finished: new Promise((resolve) => {
                resolveFinished = resolve;
            }),
        } as ReturnType<typeof Modal.createDialog>);
        return (goBack) => act(async () => resolveFinished!([goBack]));
    }

    // Haven: requirement 8 - the navigation guard PackEditor registers while dirty is what
    // RoomSettingsDialog/UserSettingsDialog actually run their own close (X button/Escape/
    // clicking outside it) and sidebar tab switching through (see SettingsNavigationGuardContext)
    // - it should hold navigation until the user explicitly picks Discard Changes out of the
    // resulting dialog. The in-page Back button (requirement from a later bug report - Back and
    // clicking outside the modal were the only two paths NOT actually guarded) shows the exact
    // same confirmation directly, without going through this context at all.
    describe("navigation guard", () => {
        async function renderDirty(): Promise<{ setGuard: ReturnType<typeof vi.fn>; onBack: ReturnType<typeof vi.fn> }> {
            const room = mkStubRoom("!room:example.org", "Room", client);
            const setGuard = vi.fn();
            const onBack = vi.fn();
            render(
                <SettingsNavigationGuardContext.Provider value={{ setGuard }}>
                    <PackEditor room={room} pack={makePack()} canManage={true} onBack={onBack} />
                </SettingsNavigationGuardContext.Provider>,
            );
            const nameField = screen.getByRole("textbox", { name: "Pack name" });
            await userEvent.clear(nameField);
            await userEvent.type(nameField, "Renamed Pack");
            await userEvent.tab();
            return { setGuard, onBack };
        }

        it("registers no guard while the pack has no unsaved changes", () => {
            const room = mkStubRoom("!room:example.org", "Room", client);
            const setGuard = vi.fn();
            render(
                <SettingsNavigationGuardContext.Provider value={{ setGuard }}>
                    <PackEditor room={room} pack={makePack()} canManage={true} onBack={vi.fn()} />
                </SettingsNavigationGuardContext.Provider>,
            );

            expect(setGuard).toHaveBeenLastCalledWith(null);
        });

        it("pops the unsaved-changes dialog once dirty, and resolves true only when Discard Changes is chosen", async () => {
            const { setGuard } = await renderDirty();

            const guard = setGuard.mock.calls.at(-1)![0] as () => Promise<boolean>;
            expect(guard).toBeInstanceOf(Function);

            // Haven: Modal.createDialog always overwrites a caller-supplied `onFinished` prop with
            // its own close handler (see Modal.tsx's own buildModal) - a naive test that grabbed
            // `onFinished` straight off the mocked call's props, like an earlier version of this
            // test did, would pass even if PackEditor made that exact mistake. Driving the real
            // `finished` promise the mock returns is what actually exercises the code path
            // PackEditor has to use, and it's what caught that bug live in the browser.
            let resolveDialog = mockNextQuestionDialog();
            let guardResult = guard();

            expect(Modal.createDialog).toHaveBeenCalledWith(
                QuestionDialog,
                expect.objectContaining({
                    button: "Go back",
                    cancelButton: "Discard Changes",
                    cancelButtonClass: "danger",
                }),
            );
            expect(vi.mocked(Modal.createDialog).mock.calls[0][1]).not.toHaveProperty("onFinished");

            // "Go Back" (or dismissing the dialog any other way) must not lose the edit.
            await resolveDialog(true);
            expect(await guardResult).toBe(false);
            expect(screen.getByRole("textbox", { name: "Pack name" })).toHaveValue("Renamed Pack");

            // Only the explicit Discard Changes click discards the draft and resolves true.
            resolveDialog = mockNextQuestionDialog();
            guardResult = guard();
            await resolveDialog(false);
            expect(await guardResult).toBe(true);
            expect(screen.getByRole("textbox", { name: "Pack name" })).toHaveValue("My Pack");
        });

        it("clears the guard once the discarded pack is no longer dirty", async () => {
            const { setGuard } = await renderDirty();
            setGuard.mockClear();

            await userEvent.click(screen.getByRole("button", { name: "Discard Changes" }));

            expect(setGuard).toHaveBeenLastCalledWith(null);
        });

        it("shows the same unsaved-changes confirmation for the Back button, and only navigates back on Discard Changes", async () => {
            const { onBack } = await renderDirty();

            const resolveDialog = mockNextQuestionDialog();
            await userEvent.click(screen.getByRole("button", { name: "← Back" }));

            expect(Modal.createDialog).toHaveBeenCalledWith(
                QuestionDialog,
                expect.objectContaining({
                    button: "Go back",
                    cancelButton: "Discard Changes",
                    cancelButtonClass: "danger",
                }),
            );
            expect(onBack).not.toHaveBeenCalled();

            await resolveDialog(false);

            expect(onBack).toHaveBeenCalledTimes(1);
        });

        it("does not warn on Back when there are no unsaved changes", async () => {
            const room = mkStubRoom("!room:example.org", "Room", client);
            const onBack = vi.fn();
            render(<PackEditor room={room} pack={makePack()} canManage={true} onBack={onBack} />);

            await userEvent.click(screen.getByRole("button", { name: "← Back" }));

            expect(Modal.createDialog).not.toHaveBeenCalled();
            expect(onBack).toHaveBeenCalledTimes(1);
        });
    });
});

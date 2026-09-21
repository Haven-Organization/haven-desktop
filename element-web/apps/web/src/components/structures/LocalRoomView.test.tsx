/*
Copyright 2026 Haven

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React, { type PropsWithChildren } from "react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import { createTestClient } from "test-utils";

import { LocalRoomView } from "./RoomView";
import { LocalRoom, LOCAL_ROOM_ID_PREFIX } from "../../models/LocalRoom";
import MatrixClientContext from "../../contexts/MatrixClientContext";
import { checkUserIsAllowedToChangeEncryption } from "../../createRoom";
import { privateShouldBeEncrypted } from "../../utils/rooms";
import type ResizeNotifier from "../../utils/ResizeNotifier";
import type { RoomPermalinkCreator } from "../../utils/permalinks/Permalinks";

// Haven: the pre-send encryption toggle on the new-DM screen (LocalRoomView in RoomView.tsx, an
// upstream-owned file). Everything around the toggle is stubbed out - this only cares that the
// toggle is there, starts from the right default, is forced/disabled the way the create-room dialog's
// is, and writes the user's choice through to the LocalRoom that startDm() later reads it from.

let currentRoom: LocalRoom;

vi.mock("../../contexts/ScopedRoomContext", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../contexts/ScopedRoomContext")>()),
    useScopedRoomContext: () => ({ room: currentRoom }),
}));
vi.mock("../views/rooms/RoomHeader/RoomHeader", () => ({ default: () => <div data-testid="room-header" /> }));
vi.mock("../views/rooms/MessageComposer", () => ({ default: () => <div data-testid="composer" /> }));
vi.mock("../views/rooms/NewRoomIntro", () => ({ default: () => <div data-testid="new-room-intro" /> }));
vi.mock("./FileDropTarget", () => ({ default: () => null }));
vi.mock("./ScrollPanel", () => ({ default: ({ children }: PropsWithChildren) => <div>{children}</div> }));
vi.mock("../../viewmodels/room/RoomUploadViewModel.tsx", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../viewmodels/room/RoomUploadViewModel.tsx")>()),
    RoomUploadContextProvider: ({ children }: PropsWithChildren) => <>{children}</>,
}));
vi.mock("../../utils/rooms", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../utils/rooms")>()),
    privateShouldBeEncrypted: vi.fn(),
}));
vi.mock("../../createRoom", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../createRoom")>()),
    checkUserIsAllowedToChangeEncryption: vi.fn(),
}));

describe("<LocalRoomView /> pre-send encryption toggle", () => {
    let client: MatrixClient;
    let onEncryptionChanged: () => void;

    function renderView(): void {
        render(
            <MatrixClientContext.Provider value={client}>
                <LocalRoomView
                    localRoom={currentRoom}
                    resizeNotifier={{} as unknown as ResizeNotifier}
                    permalinkCreator={{} as unknown as RoomPermalinkCreator}
                    roomView={{ current: null }}
                    onEncryptionChanged={onEncryptionChanged}
                />
            </MatrixClientContext.Provider>,
        );
    }

    const getToggle = (): HTMLInputElement =>
        screen.getByRole("switch", { name: "Enable end-to-end encryption" }) as HTMLInputElement;

    beforeEach(() => {
        client = createTestClient();
        currentRoom = new LocalRoom(LOCAL_ROOM_ID_PREFIX + "test", client, "@me:localhost");
        onEncryptionChanged = vi.fn();
        vi.mocked(privateShouldBeEncrypted).mockReturnValue(true);
        vi.mocked(checkUserIsAllowedToChangeEncryption).mockResolvedValue({ allowChange: true });
    });

    it("shows the toggle, on by default, with the same warning as the create room dialog", async () => {
        renderView();

        await waitFor(() => expect(getToggle()).toBeEnabled());
        expect(getToggle().checked).toBe(true);
        expect(screen.getByText("You can't disable this later. Bridges & most bots won't work yet.")).toBeTruthy();
        expect(currentRoom.encrypted).toBe(true);
    });

    it("still renders the intro and the composer around the toggle", async () => {
        renderView();

        await waitFor(() => expect(getToggle()).toBeEnabled());
        expect(screen.getByTestId("new-room-intro")).toBeTruthy();
        expect(screen.getByTestId("composer")).toBeTruthy();
    });

    it("starts off when the server's well-known defaults encryption off, and says so", async () => {
        vi.mocked(privateShouldBeEncrypted).mockReturnValue(false);
        renderView();

        await waitFor(() => expect(getToggle()).toBeEnabled());
        expect(getToggle().checked).toBe(false);
        expect(
            screen.getByText(
                "Your server admin has disabled end-to-end encryption by default in private rooms & Direct Messages.",
            ),
        ).toBeTruthy();
        expect(currentRoom.encrypted).toBe(false);
    });

    it("writes the user's choice through to the local room and tells the room view", async () => {
        renderView();
        await waitFor(() => expect(getToggle()).toBeEnabled());
        vi.mocked(onEncryptionChanged).mockClear();

        await userEvent.click(getToggle());

        expect(getToggle().checked).toBe(false);
        expect(currentRoom.encrypted).toBe(false);
        expect(onEncryptionChanged).toHaveBeenCalledTimes(1);

        await userEvent.click(getToggle());

        expect(getToggle().checked).toBe(true);
        expect(currentRoom.encrypted).toBe(true);
    });

    it("is disabled and forced on when the server requires encryption", async () => {
        vi.mocked(checkUserIsAllowedToChangeEncryption).mockResolvedValue({ allowChange: false, forcedValue: true });
        renderView();

        await waitFor(() => expect(getToggle().checked).toBe(true));
        expect(getToggle()).toBeDisabled();
        expect(screen.getByText("Your server requires encryption to be enabled in private rooms.")).toBeTruthy();
        expect(currentRoom.encrypted).toBe(true);
    });

    it("is disabled and forced off when the server requires encryption to be disabled", async () => {
        vi.mocked(privateShouldBeEncrypted).mockReturnValue(false);
        vi.mocked(checkUserIsAllowedToChangeEncryption).mockResolvedValue({ allowChange: false, forcedValue: false });
        renderView();

        await waitFor(() => expect(getToggle()).toBeDisabled());
        expect(getToggle().checked).toBe(false);
        expect(currentRoom.encrypted).toBe(false);
    });
});

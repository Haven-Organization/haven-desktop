/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, vi } from "vitest";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import { createTestClient } from "test-utils";

import { startDm } from "./startDm";
import { determineCreateRoomEncryptionOption, type Member } from "../direct-messages";
import createRoom from "../../createRoom";
import { findDMForUser } from "./findDMForUser";

vi.mock("../direct-messages", () => ({
    determineCreateRoomEncryptionOption: vi.fn(),
}));

vi.mock("./findDMForUser", () => ({
    findDMForUser: vi.fn(),
}));

vi.mock("../../createRoom", () => ({
    default: vi.fn(),
}));

// Haven: regression coverage for startDm()'s `encryptionOverride` parameter - how the pre-send DM
// screen's "Enable end-to-end encryption" toggle (see LocalRoomView in RoomView.tsx) actually
// reaches the real room. Without it startDm() always recomputed its own default from
// determineCreateRoomEncryptionOption(), silently discarding whatever the user chose.
describe("startDm encryptionOverride", () => {
    let client: MatrixClient;
    const member = { userId: "@target:example.com", name: "Target", getMxcAvatarUrl: () => undefined } as Member;

    const lastCreateRoomOptions = (): Record<string, unknown> => vi.mocked(createRoom).mock.calls[0][1] as any;

    beforeEach(() => {
        vi.clearAllMocks();
        client = createTestClient();
        vi.mocked(findDMForUser).mockReturnValue(undefined);
        vi.mocked(createRoom).mockResolvedValue("!new:example.com");
    });

    it("encrypts when the override is true, without consulting determineCreateRoomEncryptionOption", async () => {
        vi.mocked(determineCreateRoomEncryptionOption).mockResolvedValue(false);

        await startDm(client, [member], false, true);

        expect(determineCreateRoomEncryptionOption).not.toHaveBeenCalled();
        expect(lastCreateRoomOptions().encryption).toBe(true);
    });

    it("does not encrypt when the override is false, even if the default would have", async () => {
        vi.mocked(determineCreateRoomEncryptionOption).mockResolvedValue(true);

        await startDm(client, [member], false, false);

        expect(determineCreateRoomEncryptionOption).not.toHaveBeenCalled();
        expect(lastCreateRoomOptions()).not.toHaveProperty("encryption");
    });

    it("falls back to determineCreateRoomEncryptionOption when there is no override", async () => {
        vi.mocked(determineCreateRoomEncryptionOption).mockResolvedValue(true);

        await startDm(client, [member], false);

        expect(determineCreateRoomEncryptionOption).toHaveBeenCalledWith(client, [member]);
        expect(lastCreateRoomOptions().encryption).toBe(true);
    });

    it("falls back to not encrypting when there is no override and the default says no", async () => {
        vi.mocked(determineCreateRoomEncryptionOption).mockResolvedValue(false);

        await startDm(client, [member], false);

        expect(determineCreateRoomEncryptionOption).toHaveBeenCalledTimes(1);
        expect(lastCreateRoomOptions()).not.toHaveProperty("encryption");
    });
});

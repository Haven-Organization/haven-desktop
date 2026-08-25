/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

// @vitest-environment happy-dom

import { RoomType, type ICreateRoomOpts, type MatrixClient } from "matrix-js-sdk/src/matrix";
import { vi, describe, it, expect, beforeEach } from "vitest";

import createRoom, { DEFAULT_EVENTS_POWER_LEVEL } from "./createRoom";
import { JitsiCall } from "./models/Call";
import { ElementCallMemberEventType } from "./call-types";

vi.mock("./models/Call", () => ({
    JitsiCall: { create: vi.fn().mockResolvedValue(undefined), MEMBER_EVENT_TYPE: "io.element.call.member" },
    ElementCall: { create: vi.fn() },
}));

function createStubClient(): MatrixClient {
    return {
        isGuest: vi.fn().mockReturnValue(false),
        getUserId: vi.fn().mockReturnValue("@me:example.org"),
        getIdentityServerUrl: vi.fn(),
        getCapabilities: vi.fn().mockResolvedValue({}),
        createRoom: vi.fn().mockResolvedValue({ room_id: "!newroom:example.org" }),
        getRoom: vi.fn().mockReturnValue({ roomId: "!newroom:example.org", hasEncryptionStateEvent: () => false }),
        on: vi.fn(),
        off: vi.fn(),
        getDomain: vi.fn(),
    } as unknown as MatrixClient;
}

// Haven: regression coverage for the power_level_content_override merge fix - both branches used
// to REPLACE any caller-supplied power_level_content_override wholesale with Haven's own additions
// (call-membership/widget power levels), silently discarding e.g. Social's own profile/group room
// posting-permission overrides. The fix merges onto the caller's override instead.
describe("createRoom - power_level_content_override merge", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("merges a caller-supplied override with the defaults for a plain room (group-call branch)", async () => {
        const client = createStubClient();
        const callerOverride = { events: { "com.example.custom": 0 } };

        await createRoom(client, {
            spinner: false,
            andView: false,
            createOpts: { power_level_content_override: callerOverride } as ICreateRoomOpts,
        });

        expect(client.createRoom).toHaveBeenCalledTimes(1);
        const passedOpts = (client.createRoom as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(passedOpts.power_level_content_override.events).toMatchObject({
            ...DEFAULT_EVENTS_POWER_LEVEL,
            "com.example.custom": 0,
            [ElementCallMemberEventType.name]: 0,
        });
    });

    it("merges a caller-supplied override with the defaults for a video room", async () => {
        const client = createStubClient();
        const callerOverride = { events: { "com.example.custom": 0 } };

        await createRoom(client, {
            spinner: false,
            andView: false,
            roomType: RoomType.ElementVideo,
            createOpts: { power_level_content_override: callerOverride } as ICreateRoomOpts,
        });

        expect(client.createRoom).toHaveBeenCalledTimes(1);
        const passedOpts = (client.createRoom as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(passedOpts.power_level_content_override.events).toMatchObject({
            ...DEFAULT_EVENTS_POWER_LEVEL,
            "com.example.custom": 0,
            [JitsiCall.MEMBER_EVENT_TYPE]: 0,
            "im.vector.modular.widgets": 100,
        });
    });
});

/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "test-utils-rtl";
import { stubClient } from "test-utils";

import UserDevicesDialog from "./UserDevicesDialog";
import { type IDevice } from "../right_panel/UserInfo";

function makeDevice(overrides: Partial<IDevice>): IDevice {
    return {
        userId: "@alice:example.org",
        deviceId: "DEVICEID1",
        algorithms: [],
        keys: new Map(),
        signatures: new Map(),
        ...overrides,
    } as IDevice;
}

// Haven: regression coverage for the "View Devices" dialog added below UserInfo's own Verify User
// link - covers the count in the title, falling back to the device ID when no display name is
// exposed (a real, expected case per Matrix's own /keys/query privacy behavior), and the empty
// state for an account with no tracked devices.
describe("UserDevicesDialog", () => {
    beforeEach(() => {
        stubClient();
    });

    it("shows the device count in the title", () => {
        const devices = [makeDevice({ deviceId: "AAA", displayName: "Alice's phone" }), makeDevice({ deviceId: "BBB" })];
        render(<UserDevicesDialog devices={devices} onFinished={vi.fn()} />);
        expect(screen.getByText("Devices (2)")).toBeInTheDocument();
    });

    it("shows the display name when one is set", () => {
        render(<UserDevicesDialog devices={[makeDevice({ deviceId: "AAA", displayName: "Alice's phone" })]} onFinished={vi.fn()} />);
        expect(screen.getByText("Alice's phone")).toBeInTheDocument();
        // The device ID is still shown (copyable), not just the display name.
        expect(screen.getByText("AAA")).toBeInTheDocument();
    });

    it("falls back to the device ID when no display name is exposed", () => {
        render(<UserDevicesDialog devices={[makeDevice({ deviceId: "AAA", displayName: undefined })]} onFinished={vi.fn()} />);
        expect(screen.getAllByText("AAA")).toHaveLength(1);
    });

    it("shows an empty state with no devices", () => {
        render(<UserDevicesDialog devices={[]} onFinished={vi.fn()} />);
        expect(screen.getByText("Devices (0)")).toBeInTheDocument();
        expect(screen.getByText("No devices found.")).toBeInTheDocument();
    });
});

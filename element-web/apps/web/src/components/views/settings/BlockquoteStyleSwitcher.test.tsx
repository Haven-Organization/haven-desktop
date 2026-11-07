/*
Copyright 2026 Haven

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { vi, describe, it, expect, afterEach } from "vitest";
import { render, screen, waitFor } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";

import { BlockquoteStyleSwitcher } from "./BlockquoteStyleSwitcher";
import SettingsStore from "../../../settings/SettingsStore";
import SdkConfig from "../../../SdkConfig";
import { SettingLevel } from "../../../settings/SettingLevel";

// Haven: the blockquote style dropdown in Settings > Preferences > Composer.

afterEach(() => {
    vi.restoreAllMocks();
});

function setup(host: string | undefined, own: string | null): void {
    vi.spyOn(SdkConfig, "get").mockReturnValue({ haven: { blockquote_style: host } } as never);
    vi.spyOn(SettingsStore, "getValue").mockImplementation(((name: string) =>
        name === "Haven.blockquoteStyle" ? own : undefined) as never);
    vi.spyOn(SettingsStore, "watchSetting").mockReturnValue("watcher");
    vi.spyOn(SettingsStore, "unwatchSetting").mockImplementation(() => {});
}

describe("<BlockquoteStyleSwitcher />", () => {
    it("shows the host's style until the user picks one", () => {
        setup("greentext", null);
        render(<BlockquoteStyleSwitcher />);
        expect(screen.getByRole("button")).toHaveTextContent("Greentext");
    });

    it("shows the user's own style over the host's", () => {
        setup("greentext", "stock");
        render(<BlockquoteStyleSwitcher />);
        expect(screen.getByRole("button")).toHaveTextContent("Quote");
    });

    it("offers a quote and greentext, each shown in its own style", async () => {
        setup(undefined, null);
        render(<BlockquoteStyleSwitcher />);
        await userEvent.click(screen.getByRole("button"));
        const options = screen.getAllByRole("option");
        expect(options.map((option) => option.textContent)).toEqual(["Quote", ">Greentext"]);
        expect(options[0].querySelector(".mx_BlockquoteStyleSwitcher_quote")).not.toBeNull();
        expect(options[1].querySelector(".mx_BlockquoteStyleSwitcher_greentext")).not.toBeNull();
    });

    it("saves the choice to the account", async () => {
        setup("stock", null);
        const setValue = vi.spyOn(SettingsStore, "setValue").mockResolvedValue();
        render(<BlockquoteStyleSwitcher />);
        await userEvent.click(screen.getByRole("button"));
        await userEvent.click(screen.getByRole("option", { name: /Greentext/ }));
        await waitFor(() =>
            expect(setValue).toHaveBeenCalledWith("Haven.blockquoteStyle", null, SettingLevel.ACCOUNT, "greentext"),
        );
    });
});

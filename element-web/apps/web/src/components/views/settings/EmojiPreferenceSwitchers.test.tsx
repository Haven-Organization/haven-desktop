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

import { EmojiSkinToneSwitcher, GunEmojiStyleSwitcher } from "./EmojiPreferenceSwitchers";
import SettingsStore from "../../../settings/SettingsStore";
import { SettingLevel } from "../../../settings/SettingLevel";
import { GunEmojiStyle } from "../../../settings/enums/GunEmojiStyle";

// Haven: the two preference dropdowns on the Emoji & Stickers settings tab.

afterEach(() => {
    vi.restoreAllMocks();
});

function mockSetting(values: Record<string, unknown>): void {
    vi.spyOn(SettingsStore, "getValue").mockImplementation((name: string): any => values[name]);
    vi.spyOn(SettingsStore, "watchSetting").mockReturnValue("watcher");
    vi.spyOn(SettingsStore, "unwatchSetting").mockImplementation(() => {});
}

async function openDropdown(): Promise<void> {
    await userEvent.click(screen.getByRole("button"));
}

describe("<GunEmojiStyleSwitcher />", () => {
    it("shows the current style", () => {
        mockSetting({ "Haven.gunEmojiStyle": GunEmojiStyle.Revolver });
        render(<GunEmojiStyleSwitcher />);

        expect(screen.getByRole("button")).toHaveTextContent("Revolver");
    });

    it("offers revolver, handgun and water pistol", async () => {
        mockSetting({ "Haven.gunEmojiStyle": GunEmojiStyle.Handgun });
        render(<GunEmojiStyleSwitcher />);

        await openDropdown();
        expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
            "\u{1F52B}Revolver",
            "\u{1F52B}Handgun",
            "\u{1F52B}Water Pistol",
        ]);
    });

    it("explains that it doesn't affect what others see and needs the bundled emoji font", () => {
        mockSetting({ "Haven.gunEmojiStyle": GunEmojiStyle.Handgun });
        render(<GunEmojiStyleSwitcher />);

        expect(screen.getByText(/doesn't change what other people see/)).toBeInTheDocument();
        expect(screen.getByText(/Use bundled emoji font/)).toBeInTheDocument();
    });

    it("saves the chosen style at device level", async () => {
        mockSetting({ "Haven.gunEmojiStyle": GunEmojiStyle.Handgun });
        const setValue = vi.spyOn(SettingsStore, "setValue").mockResolvedValue(undefined);
        render(<GunEmojiStyleSwitcher />);

        await openDropdown();
        await userEvent.click(screen.getByRole("option", { name: /Water Pistol/ }));

        await waitFor(() =>
            expect(setValue).toHaveBeenCalledWith(
                "Haven.gunEmojiStyle",
                null,
                SettingLevel.DEVICE,
                GunEmojiStyle.WaterPistol,
            ),
        );
    });
});

describe("<EmojiSkinToneSwitcher />", () => {
    it("shows the current tone", () => {
        mockSetting({ "Haven.emojiSkinTone": "medium" });
        render(<EmojiSkinToneSwitcher />);

        expect(screen.getByRole("button")).toHaveTextContent("Medium");
    });

    it("offers the default plus the five standard skin tones", async () => {
        mockSetting({ "Haven.emojiSkinTone": "none" });
        render(<EmojiSkinToneSwitcher />);

        await openDropdown();
        expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
            "\u{1F44D}Default",
            "\u{1F44D}\u{1F3FB}Light",
            "\u{1F44D}\u{1F3FC}Medium-light",
            "\u{1F44D}\u{1F3FD}Medium",
            "\u{1F44D}\u{1F3FE}Medium-dark",
            "\u{1F44D}\u{1F3FF}Dark",
        ]);
    });

    it("saves the chosen tone to the account", async () => {
        mockSetting({ "Haven.emojiSkinTone": "none" });
        const setValue = vi.spyOn(SettingsStore, "setValue").mockResolvedValue(undefined);
        render(<EmojiSkinToneSwitcher />);

        await openDropdown();
        await userEvent.click(screen.getByRole("option", { name: /Medium-dark/ }));

        await waitFor(() =>
            expect(setValue).toHaveBeenCalledWith("Haven.emojiSkinTone", null, SettingLevel.ACCOUNT, "medium-dark"),
        );
    });
});

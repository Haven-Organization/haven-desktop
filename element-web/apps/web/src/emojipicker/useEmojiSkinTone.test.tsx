/*
 * Haven: regression coverage for wiring the emoji skin tone setting into both emoji picker wrappers
 * and the hook they share.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

// @vitest-environment happy-dom

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, renderHook } from "test-utils-rtl";
import { stubClient, mkStubRoom } from "test-utils";

import { useEmojiSkinTone } from "./useEmojiSkinTone";
import { HavenEmojiPicker } from "./HavenEmojiPicker";
import { EmojiPickerWithRecents } from "./EmojiPickerWithRecents";
import SettingsStore from "../settings/SettingsStore";
import { SettingLevel } from "../settings/SettingLevel";

vi.mock("../dispatcher/dispatcher");

let capturedProps: any;
vi.mock("@element-hq/web-shared-components", async (importOriginal) => {
    const actual = await importOriginal<
        typeof import("@element-hq/web-shared-components")
    >();
    return {
        ...actual,
        EmojiPicker: (props: any) => {
            capturedProps = props;
            return <div data-testid="shared-emoji-picker" />;
        },
    };
});

describe("emoji skin tone wiring", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        capturedProps = undefined;
    });

    describe("useEmojiSkinTone", () => {
        it("defaults to no tone", () => {
            const { result } = renderHook(() => useEmojiSkinTone());
            expect(result.current.skinTone).toBe("none");
        });

        it("reads the account-level setting", () => {
            vi.spyOn(SettingsStore, "getValue").mockImplementation((name) =>
                name === "Haven.emojiSkinTone"
                    ? "medium-dark"
                    : (undefined as any)
            );
            const { result } = renderHook(() => useEmojiSkinTone());
            expect(result.current.skinTone).toBe("medium-dark");
        });

        it("saves a chosen tone to the user's account, not just this device", () => {
            const setValue = vi
                .spyOn(SettingsStore, "setValue")
                .mockResolvedValue(undefined);
            const { result } = renderHook(() => useEmojiSkinTone());

            result.current.onSkinToneChange("light");

            expect(setValue).toHaveBeenCalledExactlyOnceWith(
                "Haven.emojiSkinTone",
                null,
                SettingLevel.ACCOUNT,
                "light"
            );
        });
    });

    describe("pickers", () => {
        beforeEach(() => {
            vi.spyOn(SettingsStore, "getValue").mockImplementation((name) =>
                name === "Haven.emojiSkinTone" ? "dark" : (undefined as any)
            );
        });

        it("HavenEmojiPicker passes the tone and its setter to the shared picker", () => {
            const client = stubClient();
            render(
                <HavenEmojiPicker
                    onChoose={() => true}
                    onFinished={vi.fn()}
                    room={mkStubRoom("!room:example.org", "Room", client)}
                />
            );
            expect(capturedProps.skinTone).toBe("dark");
            expect(capturedProps.onSkinToneChange).toBeInstanceOf(Function);
        });

        it("EmojiPickerWithRecents passes the tone and its setter to the shared picker", () => {
            render(
                <EmojiPickerWithRecents
                    onChoose={() => true}
                    onFinished={vi.fn()}
                />
            );
            expect(capturedProps.skinTone).toBe("dark");
            expect(capturedProps.onSkinToneChange).toBeInstanceOf(Function);
        });
    });
});

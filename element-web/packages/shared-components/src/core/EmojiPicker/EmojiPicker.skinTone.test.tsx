/*
 * Haven: regression coverage for the emoji picker's skin tone support (the button next to the search
 * box, and toning of the grid, recents and quick reactions).
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React from "react";
import userEvent from "@testing-library/user-event";
import { render, screen, within } from "@test-utils";
import { describe, expect, it, vi } from "vitest";

import { EmojiPicker } from "./EmojiPicker";

const TONE_NAMES = [
    "Default skin tone",
    "Light skin tone",
    "Medium-light skin tone",
    "Medium skin tone",
    "Medium-dark skin tone",
    "Dark skin tone",
];

describe("EmojiPicker skin tone", () => {
    describe("selector button", () => {
        it("is absent when the picker has no skin tone handler", () => {
            render(<EmojiPicker onChoose={() => false} onFinished={vi.fn()} />);
            expect(
                screen.queryByRole("button", { name: "Skin tone" })
            ).not.toBeInTheDocument();
        });

        it("is absent in sticker mode even with a handler", () => {
            render(
                <EmojiPicker
                    onChoose={() => false}
                    onFinished={vi.fn()}
                    mode="sticker"
                    stickerCategories={[]}
                    onSkinToneChange={vi.fn()}
                />
            );
            expect(
                screen.queryByRole("button", { name: "Skin tone" })
            ).not.toBeInTheDocument();
        });

        it("sits to the right of the search box, showing a hand in the current tone", () => {
            render(
                <EmojiPicker
                    onChoose={() => false}
                    onFinished={vi.fn()}
                    skinTone="medium-dark"
                    onSkinToneChange={vi.fn()}
                />
            );
            const search = screen.getByLabelText("Search");
            const button = screen.getByRole("button", { name: "Skin tone" });
            expect(button).toHaveTextContent("👋🏾");
            expect(
                search.compareDocumentPosition(button) &
                    Node.DOCUMENT_POSITION_FOLLOWING
            ).toBeTruthy();
            expect(search.closest("div")?.parentElement).toBe(
                button.parentElement?.parentElement
            );
        });

        it("opens a radio group of every tone with the current one checked", async () => {
            render(
                <EmojiPicker
                    onChoose={() => false}
                    onFinished={vi.fn()}
                    skinTone="dark"
                    onSkinToneChange={vi.fn()}
                />
            );
            const button = screen.getByRole("button", { name: "Skin tone" });
            expect(button).toHaveAttribute("aria-expanded", "false");
            expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();

            await userEvent.click(button);

            expect(button).toHaveAttribute("aria-expanded", "true");
            const radios = within(screen.getByRole("radiogroup")).getAllByRole(
                "radio"
            );
            expect(radios.map((r) => r.getAttribute("aria-label"))).toEqual(
                TONE_NAMES
            );
            expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual([
                "false",
                "false",
                "false",
                "false",
                "false",
                "true",
            ]);
        });

        it("reports the chosen tone and closes, returning focus to the button", async () => {
            const onSkinToneChange = vi.fn();
            const onFinished = vi.fn();
            render(
                <EmojiPicker
                    onChoose={() => false}
                    onFinished={onFinished}
                    onSkinToneChange={onSkinToneChange}
                />
            );

            await userEvent.click(
                screen.getByRole("button", { name: "Skin tone" })
            );
            await userEvent.click(
                screen.getByRole("radio", { name: "Medium skin tone" })
            );

            expect(onSkinToneChange).toHaveBeenCalledExactlyOnceWith("medium");
            expect(onFinished).not.toHaveBeenCalled();
            expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
            expect(
                screen.getByRole("button", { name: "Skin tone" })
            ).toHaveFocus();
        });

        it("moves between tones with the arrow keys, keeping those keys away from the emoji grid", async () => {
            const onChoose = vi.fn(() => false);
            const onKeyDown = vi.fn();
            render(
                // eslint-disable-next-line jsx-a11y/no-static-element-interactions
                <div onKeyDown={onKeyDown}>
                    <EmojiPicker
                        onChoose={onChoose}
                        onFinished={vi.fn()}
                        recentEmojis={["😀", "🎉"]}
                        onSkinToneChange={vi.fn()}
                    />
                </div>,
            );
            await userEvent.click(screen.getByRole("button", { name: "Skin tone" }));
            // Opens focused on the current tone (Default)
            expect(screen.getByRole("radio", { name: "Default skin tone" })).toHaveFocus();

            await userEvent.keyboard("[ArrowRight]");
            expect(screen.getByRole("radio", { name: "Light skin tone" })).toHaveFocus();
            await userEvent.keyboard("[ArrowLeft][ArrowLeft]");
            expect(screen.getByRole("radio", { name: "Dark skin tone" })).toHaveFocus();
            await userEvent.keyboard("[Home]");
            expect(screen.getByRole("radio", { name: "Default skin tone" })).toHaveFocus();
            await userEvent.keyboard("[End]");
            expect(screen.getByRole("radio", { name: "Dark skin tone" })).toHaveFocus();

            // The picker's roving grid handler lives on an ancestor and must never see these.
            expect(onKeyDown).not.toHaveBeenCalled();
            expect(onChoose).not.toHaveBeenCalled();
        });

        it("closes on Escape without letting the key reach the rest of the picker", async () => {
            const onKeyDown = vi.fn();
            render(
                // eslint-disable-next-line jsx-a11y/no-static-element-interactions
                <div onKeyDown={onKeyDown}>
                    <EmojiPicker
                        onChoose={() => false}
                        onFinished={vi.fn()}
                        onSkinToneChange={vi.fn()}
                    />
                </div>
            );
            await userEvent.click(
                screen.getByRole("button", { name: "Skin tone" })
            );
            await userEvent.keyboard("[Escape]");

            expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
            expect(
                screen.getByRole("button", { name: "Skin tone" })
            ).toHaveFocus();
            expect(onKeyDown).not.toHaveBeenCalled();
        });

        it("leaves Escape alone while closed so it can still dismiss the picker", async () => {
            const onKeyDown = vi.fn();
            render(
                // eslint-disable-next-line jsx-a11y/no-static-element-interactions
                <div onKeyDown={onKeyDown}>
                    <EmojiPicker
                        onChoose={() => false}
                        onFinished={vi.fn()}
                        onSkinToneChange={vi.fn()}
                    />
                </div>
            );
            screen.getByRole("button", { name: "Skin tone" }).focus();
            await userEvent.keyboard("[Escape]");
            expect(onKeyDown).toHaveBeenCalledWith(
                expect.objectContaining({ key: "Escape" })
            );
        });

        it("closes when clicking elsewhere", async () => {
            render(
                <EmojiPicker
                    onChoose={() => false}
                    onFinished={vi.fn()}
                    onSkinToneChange={vi.fn()}
                />
            );
            await userEvent.click(
                screen.getByRole("button", { name: "Skin tone" })
            );
            expect(screen.getByRole("radiogroup")).toBeInTheDocument();

            await userEvent.click(screen.getByLabelText("Search"));
            expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
        });
    });

    describe("toning", () => {
        it("tones quick reactions that have skin variants and leaves the rest", () => {
            render(
                <EmojiPicker
                    onChoose={() => false}
                    onFinished={vi.fn()}
                    skinTone="dark"
                />
            );
            const quick = screen.getByRole("toolbar");
            expect(
                within(quick).getByRole("button", { name: "👍🏿" })
            ).toBeInTheDocument();
            expect(
                within(quick).getByRole("button", { name: "👎🏿" })
            ).toBeInTheDocument();
            expect(
                within(quick).getByRole("button", { name: "🚀" })
            ).toBeInTheDocument();
        });

        it("leaves quick reactions untoned by default", () => {
            render(<EmojiPicker onChoose={() => false} onFinished={vi.fn()} />);
            expect(
                within(screen.getByRole("toolbar")).getByRole("button", {
                    name: "👍\uFE0F",
                })
            ).toBeInTheDocument();
        });

        it("shows recents in the current tone, even ones that were picked in another tone", async () => {
            render(
                <EmojiPicker
                    onChoose={() => false}
                    onFinished={vi.fn()}
                    recentEmojis={["👋🏻", "🎉"]}
                    skinTone="dark"
                />
            );
            const grid = screen.getByRole("grid");
            expect(
                await within(grid).findByRole("button", { name: "👋🏿" })
            ).toBeInTheDocument();
            expect(
                within(grid).queryByRole("button", { name: "👋🏻" })
            ).not.toBeInTheDocument();
            expect(
                within(grid).getByRole("button", { name: "🎉" })
            ).toBeInTheDocument();
        });

        it("collapses recents that differ only by tone into one entry", async () => {
            render(
                <EmojiPicker
                    onChoose={() => false}
                    onFinished={vi.fn()}
                    recentEmojis={["👋", "👋🏽", "👋🏿"]}
                    skinTone="light"
                />
            );
            const grid = screen.getByRole("grid");
            await within(grid).findByRole("button", { name: "👋🏻" });
            expect(
                within(grid).getAllByRole("button", { name: /^👋/ })
            ).toHaveLength(1);
        });

        it("chooses and records the toned emoji", async () => {
            const onChoose = vi.fn(() => true);
            const onRecordRecent = vi.fn();
            render(
                <EmojiPicker
                    onChoose={onChoose}
                    onFinished={vi.fn()}
                    onRecordRecent={onRecordRecent}
                    recentEmojis={["👋"]}
                    skinTone="medium"
                />
            );
            await userEvent.click(
                await within(screen.getByRole("grid")).findByRole("button", {
                    name: "👋🏽",
                })
            );

            expect(onChoose).toHaveBeenCalledWith(
                "👋🏽",
                expect.objectContaining({ unicode: "👋🏽" })
            );
            expect(onRecordRecent).toHaveBeenCalledWith("👋🏽");
        });

        it("keeps freeform recents as they are", async () => {
            render(
                <EmojiPicker
                    onChoose={() => false}
                    onFinished={vi.fn()}
                    recentEmojis={["lol"]}
                    skinTone="dark"
                />
            );
            expect(
                await within(screen.getByRole("grid")).findByRole("button", {
                    name: "lol",
                })
            ).toBeInTheDocument();
        });

        it("ignores the tone in sticker mode", () => {
            render(
                <EmojiPicker
                    onChoose={() => false}
                    onFinished={vi.fn()}
                    mode="sticker"
                    stickerCategories={[]}
                    skinTone="dark"
                />
            );
            expect(
                screen.queryByRole("button", { name: /🏿/ })
            ).not.toBeInTheDocument();
        });
    });
});

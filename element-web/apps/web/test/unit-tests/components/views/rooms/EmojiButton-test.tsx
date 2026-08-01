/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// Haven: regression coverage for the "Send a Sticker" keyboard shortcut's own end of the chain -
// SendMessageComposer-test.tsx covers the shortcut itself calling openStickerPickerViaKeyboard (see
// its own doc), this covers openStickerTabRequestId (bumped by MessageComposer.tsx in response)
// actually opening this button's popup straight to the Stickers tab - see this prop's own doc in
// EmojiButton.tsx for why it's a counter, not a boolean.
import React from "react";
import { render, screen, fireEvent } from "jest-matrix-react";

import { EmojiButton } from "../../../../../src/components/views/rooms/EmojiButton";
import { stubClient } from "../../../../test-utils";
import defaultDispatcher from "../../../../../src/dispatcher/dispatcher";
import { Action } from "../../../../../src/dispatcher/actions";

describe("EmojiButton", () => {
    stubClient();

    it("does nothing on mount when openStickerTabRequestId starts at 0 (falsy)", () => {
        render(<EmojiButton addEmoji={jest.fn()} openStickerTabRequestId={0} />);
        expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    });

    it("opens straight to the Stickers tab when openStickerTabRequestId is bumped", () => {
        const { rerender } = render(<EmojiButton addEmoji={jest.fn()} openStickerTabRequestId={0} />);

        rerender(<EmojiButton addEmoji={jest.fn()} openStickerTabRequestId={1} />);

        const stickerTab = screen.getByRole("tab", { name: "Stickers" });
        expect(stickerTab).toHaveAttribute("aria-selected", "true");
    });

    it("re-opens the Stickers tab on a second bump, even after switching back to Emoji", () => {
        const { rerender } = render(<EmojiButton addEmoji={jest.fn()} openStickerTabRequestId={1} />);
        expect(screen.getByRole("tab", { name: "Stickers" })).toHaveAttribute("aria-selected", "true");

        fireEvent.click(screen.getByRole("tab", { name: "Emoji" }));
        expect(screen.getByRole("tab", { name: "Stickers" })).toHaveAttribute("aria-selected", "false");

        rerender(<EmojiButton addEmoji={jest.fn()} openStickerTabRequestId={2} />);
        expect(screen.getByRole("tab", { name: "Stickers" })).toHaveAttribute("aria-selected", "true");
    });

    it("actually closes on Escape after being opened via the keyboard shortcut, rather than immediately reopening", () => {
        render(<EmojiButton addEmoji={jest.fn()} openStickerTabRequestId={1} />);

        const stickerTab = screen.getByRole("tab", { name: "Stickers" });
        fireEvent.keyDown(stickerTab, { key: "Escape" });

        expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    });

    it("dispatches FocusAComposer on close, so a stray focus on this button doesn't eat the next keyboard shortcut press", () => {
        const dispatchSpy = jest.spyOn(defaultDispatcher, "dispatch");
        render(<EmojiButton addEmoji={jest.fn()} />);

        // Open by clicking the button directly (not via openStickerTabRequestId) - this is the
        // repro: manually opening/closing via mouse, with nothing ever chosen, previously left real
        // DOM focus stranded on this button (FocusLock's own default returnFocus target) rather than
        // back in the composer, silently eating the very next "Send a Sticker" shortcut press.
        fireEvent.click(screen.getByRole("button", { name: "Emoji" }));
        const emojiTab = screen.getByRole("tab", { name: "Emoji" });
        fireEvent.keyDown(emojiTab, { key: "Escape" });

        expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ action: Action.FocusAComposer }));
    });
});

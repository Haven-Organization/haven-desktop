/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React from "react";
import { render, screen } from "@test-utils";
import { describe, expect, it } from "vitest";

import { Preview } from "./Preview";
import { type PickerEmoji } from "./Emoji";
import styles from "./EmojiPicker.module.css";

describe("Preview", () => {
    it("shows the big glyph preview for a real emoji", () => {
        const emoji = {
            unicode: "👍",
            label: "thumbs up",
            shortcodes: ["thumbsup"],
            hexcode: "1F44D",
        } as PickerEmoji;

        const { container } = render(<Preview emoji={emoji} />);

        expect(container.querySelector(`.${styles.previewEmoji}`)).toHaveTextContent("👍");
        expect(screen.getByText("thumbs up")).toBeInTheDocument();
    });

    it("shows the big image preview for a custom pack emoji", () => {
        const emoji = {
            unicode: ":party_parrot:",
            label: "party_parrot",
            shortcodes: ["party_parrot"],
            hexcode: "custom-party-parrot",
            imageUrl: "https://example.org/party-parrot.png",
        } as PickerEmoji;

        render(<Preview emoji={emoji} />);

        expect(screen.getByAltText("party_parrot")).toHaveAttribute("src", "https://example.org/party-parrot.png");
    });

    it("skips the big text preview for a freeform (previously-sent) reaction, keeping only the caption", () => {
        const emoji = {
            unicode: "based",
            label: "based",
            shortcodes: ["based"],
            hexcode: "freeform-based",
            isFreeform: true,
        } as PickerEmoji;

        const { container } = render(<Preview emoji={emoji} />);

        expect(container.querySelector(`.${styles.previewEmoji}`)).not.toBeInTheDocument();
        expect(container.querySelector(`.${styles.previewName}`)).toHaveTextContent("based");
        expect(container.querySelector(`.${styles.shortcode}`)).toHaveTextContent("based");
        expect(container.querySelector(`.${styles.previewText}`)).toHaveClass(styles.previewTextNoIcon);
    });
});

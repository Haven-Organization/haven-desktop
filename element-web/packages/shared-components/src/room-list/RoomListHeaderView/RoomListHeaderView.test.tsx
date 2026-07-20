/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { composeStories } from "@storybook/react-vite";
import { render } from "@test-utils";
import { describe, it, expect } from "vitest";
import React from "react";

import * as stories from "./RoomListHeaderView.stories";

const { Default, NoSpaceMenu, CollapseSections, ExpandSections, SpaceSwitcher } = composeStories(stories);

describe("RoomListHeaderView", () => {
    it("renders the default state", () => {
        const { container } = render(<Default />);
        expect(container).toMatchSnapshot();
    });

    it("renders without space menu", () => {
        const { container } = render(<NoSpaceMenu />);
        expect(container).toMatchSnapshot();
    });

    it("renders collapse button", () => {
        const { container } = render(<CollapseSections />);
        expect(container).toMatchSnapshot();
    });

    it("renders expand button", () => {
        const { container } = render(<ExpandSections />);
        expect(container).toMatchSnapshot();
    });

    it("should bind the collapse all sections action", () => {
        const { getByRole } = render(<CollapseSections />);
        const collapseButton = getByRole("button", { name: "Collapse all sections" });
        collapseButton.click();
        expect(CollapseSections.args?.collapseOrExpandSections).toHaveBeenCalled();
    });

    it("renders the title as a space switcher when the spaces bar is hidden", () => {
        const { container, getByRole } = render(<SpaceSwitcher />);
        expect(container).toMatchSnapshot();
        // The title (still an <h1>, for the same heading semantics as the plain-text form) is now
        // wrapped in a clickable button that opens the space-switcher menu.
        expect(getByRole("button", { name: "Switch space" })).toHaveTextContent("Rooms");
    });
});

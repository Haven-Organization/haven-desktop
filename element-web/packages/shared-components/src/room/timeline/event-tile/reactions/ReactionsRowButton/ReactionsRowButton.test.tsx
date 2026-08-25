/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { composeStories } from "@storybook/react-vite";
import { fireEvent, render } from "@test-utils";
import React from "react";
import { describe, it, expect, vi } from "vitest";

import { useMockedViewModel } from "../../../../../core/viewmodel";
import { ReactionsRowButtonView } from "./ReactionsRowButtonView";
import * as stories from "./ReactionsRowButton.stories";

const { Default, Selected } = composeStories(stories);

describe("ReactionsRowButton", () => {
    it("renders the default reaction button", () => {
        const { container } = render(<Default />);
        expect(container).toMatchSnapshot();
    });

    it("renders the selected reaction button", () => {
        const { container } = render(<Selected />);
        expect(container).toMatchSnapshot();
    });

    // Haven: regression coverage for the fix moving onContextMenu onto a wrapping <span> - Compound's
    // Tooltip clones its trigger via Floating UI's getReferenceProps, which only forwards a fixed set
    // of known interaction handlers and silently dropped a plain onContextMenu placed on the <button>
    // itself. contextmenu bubbles, so the wrapping span still sees a right-click anywhere on the button.
    it("fires onContextMenu on a right-click, despite the button being wrapped in a Tooltip", () => {
        const onContextMenu = vi.fn();
        function Harness(): React.JSX.Element {
            const tooltipVm = useMockedViewModel({ formattedSenders: undefined, caption: undefined }, {});
            const vm = useMockedViewModel(
                { content: "👍", count: 1, isSelected: false, tooltipVm },
                { onClick: vi.fn(), onContextMenu },
            );
            return <ReactionsRowButtonView vm={vm} />;
        }
        const { getByRole } = render(<Harness />);
        fireEvent.contextMenu(getByRole("button"));
        expect(onContextMenu).toHaveBeenCalledTimes(1);
    });
});

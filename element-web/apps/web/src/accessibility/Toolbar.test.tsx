/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

// Haven: regression coverage for Toolbar.tsx's own H/J/K/L handling - guards against an upstream
// element-web merge reverting the isVerticalArrow fix (see its own comment in Toolbar.tsx) that
// keeps H/L from being wrongly treated as "vertical arrow, click the aria-haspopup button" here,
// since jkArrowEquivalent covers all four directions, not just up/down.
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "test-utils-rtl";

import * as KeyBindingsManagerModule from "../KeyBindingsManager";
import Toolbar from "./Toolbar";

vi.mock("../KeyBindingsManager", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../KeyBindingsManager")>()),
    getKeyBindingsManager: vi.fn(),
}));

function renderToolbarButton(onClick: () => void): HTMLElement {
    const { getByRole } = render(
        <Toolbar>
            <button aria-haspopup="menu" onClick={onClick}>
                btn
            </button>
        </Toolbar>,
    );
    return getByRole("button");
}

describe("Toolbar", () => {
    beforeEach(() => {
        const manager = new KeyBindingsManagerModule.KeyBindingsManager();
        vi.mocked(KeyBindingsManagerModule.getKeyBindingsManager).mockReturnValue(manager);
        vi.spyOn(manager, "getAccessibilityAction").mockReturnValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each(["j", "k"])(
        "clicks an aria-haspopup button when '%s' moves focus onto it (vertical vim keys)",
        (key) => {
            const onClick = vi.fn();
            const button = renderToolbarButton(onClick);

            fireEvent.keyDown(button, { key });

            expect(onClick).toHaveBeenCalledTimes(1);
        },
    );

    it.each(["h", "l"])("does not click an aria-haspopup button for '%s' (horizontal vim keys)", (key) => {
        const onClick = vi.fn();
        const button = renderToolbarButton(onClick);

        fireEvent.keyDown(button, { key });

        expect(onClick).not.toHaveBeenCalled();
    });
});

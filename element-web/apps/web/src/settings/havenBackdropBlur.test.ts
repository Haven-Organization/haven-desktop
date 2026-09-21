/*
 * Copyright 2026 Haven
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

// Haven: the blurred-avatar backdrop behind the room list and spaces bar (BackdropPanel.tsx) blurs its image by
// a multiple of the --lp-background-blur custom property. Upstream deleted that property from its own themes
// (2026-09 sync) - nothing conflicted, the images just silently stopped being blurred - so the themes' definitions
// are guarded here. Themes are upstream-owned files, hence the check on the files themselves.

const THEMES = resolve(import.meta.dirname, "../../res/themes");
const read = (path: string): string => readFileSync(resolve(THEMES, path), "utf8");

describe("--lp-background-blur (room list backdrop blur)", () => {
    it.each([
        ["dark", "dark/css/_dark.pcss"],
        ["light", "light/css/_light.pcss"],
    ])("is defined on :root by the %s theme", (_name, file) => {
        expect(read(file)).toMatch(/:root\s*{[^}]*--lp-background-blur:\s*\d+px;/);
    });

    it("is what BackdropPanel reads", () => {
        const panel = readFileSync(resolve(import.meta.dirname, "../components/views/rooms/BackdropPanel.tsx"), "utf8");
        expect(panel).toContain('"--lp-background-blur"');
    });
});

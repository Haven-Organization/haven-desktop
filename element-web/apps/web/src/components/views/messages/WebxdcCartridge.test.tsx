/*
 * Haven: tests for the webxdc game cartridge.
 */

// @vitest-environment happy-dom

import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "test-utils-rtl";

import { cartridgeColor, shade, WebxdcCartridge } from "./WebxdcCartridge";

describe("WebxdcCartridge", () => {
    it("picks the same color for the same file, from the bridge's palette", () => {
        const color = cartridgeColor("mxc://example.org/abc");
        expect(color).toMatch(/^#[0-9a-f]{6}$/);
        expect(cartridgeColor("mxc://example.org/abc")).toBe(color);
        const colors = new Set(Array.from({ length: 50 }, (_, i) => cartridgeColor(`mxc://example.org/${i}`)));
        expect(colors.size).toBeGreaterThan(5);
        expect(cartridgeColor(undefined)).toBe("#1ba5c4");
    });

    it("shades a color darker and lighter", () => {
        expect(shade("#808080", 0.5)).toBe("rgb(64, 64, 64)");
        expect(shade("#808080", 1.5)).toBe("rgb(192, 192, 192)");
    });

    it("shows the game's icon as the label", () => {
        const { container } = render(
            <WebxdcCartridge colorSeed="mxc://example.org/ab" iconUrl="blob:icon" title="Chess" />,
        );
        expect(container.querySelector("image")?.getAttribute("href")).toBe("blob:icon");
        expect(container.querySelector("svg")?.getAttribute("aria-label")).toBe("Chess");
    });

    it("writes the name on the label without an icon", () => {
        const { container } = render(<WebxdcCartridge colorSeed="mxc://example.org/ab" title="Chess" />);
        expect(container.querySelector("image")).toBeNull();
        expect(container.querySelector(".mx_WebxdcCartridge_title")?.textContent).toBe("Chess");
    });
});

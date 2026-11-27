/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { copyPlainTextToClipboard } from "./clipboard";

describe("copyPlainTextToClipboard", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("should copy the text with the clipboard API", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal("navigator", { clipboard: { writeText } });

        await expect(copyPlainTextToClipboard("foo")).resolves.toBe(true);
        expect(writeText).toHaveBeenCalledWith("foo");
    });

    it("should fall back to execCommand when the clipboard API is missing", async () => {
        vi.stubGlobal("navigator", {});
        // happy-dom does not implement execCommand, so provide it for this test
        const execCommand = vi.fn().mockReturnValue(true);
        document.execCommand = execCommand;

        try {
            await expect(copyPlainTextToClipboard("foo")).resolves.toBe(true);
            expect(execCommand).toHaveBeenCalledWith("copy");
            // The temporary textarea is removed
            expect(document.querySelector("textarea")).toBeNull();
        } finally {
            // @ts-expect-error -- remove the method added above
            delete document.execCommand;
        }
    });

    // Haven
    it("should copy once the window gets focus back when it was refused for lack of focus", async () => {
        const writeText = vi
            .fn()
            .mockRejectedValueOnce(new DOMException("Document is not focused.", "NotAllowedError"))
            .mockResolvedValueOnce(undefined);
        vi.stubGlobal("navigator", { clipboard: { writeText } });
        vi.spyOn(document, "hasFocus").mockReturnValue(false);

        const copied = copyPlainTextToClipboard("foo");
        await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
        window.dispatchEvent(new Event("focus"));

        await expect(copied).resolves.toBe(true);
        expect(writeText).toHaveBeenCalledTimes(2);
    });

    it("should return false when copying fails", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const writeText = vi.fn().mockRejectedValue(new Error("denied"));
        vi.stubGlobal("navigator", { clipboard: { writeText } });

        await expect(copyPlainTextToClipboard("foo")).resolves.toBe(false);
        expect(console.error).toHaveBeenCalled();
    });
});

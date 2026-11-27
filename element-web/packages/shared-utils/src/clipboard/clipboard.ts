/*
Copyright 2024 New Vector Ltd.
Copyright 2020 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Copy plaintext to user's clipboard
 * It will overwrite user's selection range
 * In certain browsers it may only work if triggered by a user action or may ask user for permissions
 * Tries to use new async clipboard API if available
 * @param text the plaintext to put in the user's clipboard
 * @returns true if the text was copied
 */
export async function copyPlainTextToClipboard(text: string): Promise<boolean> {
    try {
        if (navigator?.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(text);
            } catch (e) {
                // Haven: Chromium refuses the write while the page doesn't have focus, which a window
                // manager that focuses whatever is under the mouse takes away as soon as the mouse
                // leaves the window, even right after a click inside it. Copy once it's back.
                if (document.hasFocus() || !(await focusReturns())) throw e;
                await navigator.clipboard.writeText(text);
            }
            return true;
        } else {
            const textArea = document.createElement("textarea");
            textArea.value = text;

            // Avoid scrolling to bottom
            textArea.style.top = "0";
            textArea.style.left = "0";
            textArea.style.position = "fixed";

            document.body.appendChild(textArea);
            const selection = document.getSelection()!;
            const range = document.createRange();
            range.selectNode(textArea);
            selection.removeAllRanges();
            selection.addRange(range);

            const successful = document.execCommand("copy");
            selection.removeAllRanges();
            document.body.removeChild(textArea);
            return successful;
        }
    } catch (e) {
        console.error("copyPlainTextToClipboard failed", e);
    }
    return false;
}

/** How long a copy refused for lack of focus waits for the window to get it back. */
const FOCUS_WAIT_MS = 60_000;

/** Resolves true when the window gets focus back, or false after FOCUS_WAIT_MS. */
function focusReturns(): Promise<boolean> {
    return new Promise((resolve) => {
        const done = (focused: boolean): void => {
            window.removeEventListener("focus", onFocus);
            clearTimeout(timer);
            resolve(focused);
        };
        const onFocus = (): void => done(true);
        const timer = setTimeout(() => done(false), FOCUS_WAIT_MS);
        window.addEventListener("focus", onFocus);
    });
}

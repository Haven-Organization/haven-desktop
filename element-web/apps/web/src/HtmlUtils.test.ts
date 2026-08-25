/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

// @vitest-environment happy-dom

import { describe, it, expect } from "vitest";

import { bodyToNode } from "./HtmlUtils";

// Haven: regression coverage for the BIGEMOJI_REGEX ReDoS fix - a real backfilled fediverse post
// (thousands of repeated emoji) hit catastrophic backtracking in BIGEMOJI_REGEX.exec and froze the
// whole Feed for minutes with no recovery, since runaway regex backtracking never throws (so the
// surrounding try/catch never helped). The fix skips the regex entirely once the trimmed body is
// BIGEMOJI_REGEX_MAX_LENGTH (1000) characters or longer, rather than trying to bound/catch it.
describe("bodyToNode - big-emoji ReDoS guard", () => {
    it("still applies big-emoji styling to a short, genuinely emoji-only body", () => {
        const result = bodyToNode({ msgtype: "m.text", body: "😀😀😀" });
        expect(result.className).toContain("mx_EventTile_bigEmoji");
    });

    it("skips the big-emoji regex (and does not hang) for a pathologically long emoji-only body", () => {
        // Length 4000 (2 UTF-16 units per emoji x 2000 repeats) - comfortably past the 1000-char
        // guard, matching the shape of the real post that used to freeze the Feed.
        const longEmojiBody = "😀".repeat(2000);

        const result = bodyToNode({ msgtype: "m.text", body: longEmojiBody });

        // Regressed behaviour would either hang (this test would time out) or, if it somehow
        // completed, would still classify this as "big emoji" - the fix deliberately skips the
        // regex past the length guard, so it must NOT get the big-emoji class.
        expect(result.className).not.toContain("mx_EventTile_bigEmoji");
        expect(result.strippedBody).toBe(longEmojiBody);
    });

    it("does not crash on a body mixing thousands of emoji with HTML-like text", () => {
        const pathological = "😀".repeat(1500) + "<div>" + "🎉".repeat(1500);

        expect(() => bodyToNode({ msgtype: "m.text", body: pathological })).not.toThrow();
    });
});

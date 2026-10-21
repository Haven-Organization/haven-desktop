/*
 * Social Overlay - topicPreview tests
 *
 * Regression coverage for "a group card shows its topic's HTML tags as text" - see topicPreview.ts.
 */

// @vitest-environment happy-dom
// topicPreviewText parses HTML with DOMParser.

import { describe, it, expect } from "vitest";

import { topicPreviewText } from "./topicPreview";

describe("topicPreviewText", () => {
    it("reduces markup in the plain topic field to its visible text", () => {
        const topic = "<p>General rules:</p> <ul> <li>Be kind.</li> <li>No spam &amp; no ads.</li></ul>";
        expect(topicPreviewText({ topic })).toBe("General rules: Be kind. No spam & no ads.");
    });

    it("prefers the text/html representation when there is one", () => {
        expect(
            topicPreviewText({
                "topic": "plain",
                "m.topic": {
                    "m.text": [
                        { mimetype: "text/html", body: "<p>one</p><p>two</p>" },
                        { body: "plain" },
                    ],
                },
            }),
        ).toBe("one two");
    });

    it("keeps plain topics as they are, apart from extra whitespace", () => {
        expect(topicPreviewText({ topic: "Cats  and\ndogs, 2 < 3" })).toBe("Cats and dogs, 2 < 3");
    });

    it("is empty when there's no topic", () => {
        expect(topicPreviewText(undefined)).toBe("");
        expect(topicPreviewText({ topic: "" })).toBe("");
    });
});

/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import { render } from "@test-utils";
import { describe, it, expect } from "vitest";

import { EventContentBodyView, type EventContentBodyViewModel, type EventContentBodyViewSnapshot } from "./EventContentBodyView";

function makeVm(snapshot: EventContentBodyViewSnapshot): EventContentBodyViewModel {
    return {
        getSnapshot: () => snapshot,
        subscribe: () => () => {},
    };
}

// Haven: regression tests for a real bug - any formatted body that needs real HTML at all (e.g. a
// message with a mention pill, which requires a formatted_body/<a> tag) gets wrapped in a <p> by
// CommonMark's own single-paragraph rendering. Rendering that <p> straight into a "span" - used for
// an emote's "* name body" line, which must all sit inline on one run - puts a block-level element
// inside an inline one, forcing the browser to wrap it onto its own line (e.g. "/me gives @user a
// hug" splitting into "* q" on one line and "gives [pill] a hug" on the next).
describe("EventContentBodyView", () => {
    it("unwraps a sole top-level <p> when rendering into a span (emote case)", () => {
        const vm = makeVm({
            body: "gives @user a hug",
            formattedBody: '<p>gives <a href="https://matrix.to/#/@user:example.org">User</a> a hug</p>\n',
            className: "test",
        });
        const { container } = render(<EventContentBodyView vm={vm} as="span" />);

        const span = container.querySelector("span.test")!;
        expect(span.querySelector("p")).toBeNull();
        expect(span.textContent).toBe("gives User a hug");
    });

    it("keeps a sole top-level <p> when rendering into a div (normal message)", () => {
        const vm = makeVm({
            body: "gives @user a hug",
            formattedBody: '<p>gives <a href="https://matrix.to/#/@user:example.org">User</a> a hug</p>\n',
            className: "test",
        });
        const { container } = render(<EventContentBodyView vm={vm} as="div" />);

        const div = container.querySelector("div.test")!;
        expect(div.querySelector("p")).not.toBeNull();
    });

    it("leaves multiple top-level paragraphs alone even when rendering into a span", () => {
        const vm = makeVm({
            body: "first\n\nsecond",
            formattedBody: "<p>first</p>\n<p>second</p>\n",
            className: "test",
        });
        const { container } = render(<EventContentBodyView vm={vm} as="span" />);

        const span = container.querySelector("span.test")!;
        expect(span.querySelectorAll("p")).toHaveLength(2);
    });
});

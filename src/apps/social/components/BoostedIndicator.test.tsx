/*
 * Social Overlay - BoostedIndicator tests
 *
 * The repost header line's wording. For a repost of a repost it has to say "reposted X's repost", not
 * "reposted X's post" - otherwise it reads as though X authored whatever ends up being shown.
 */

// @vitest-environment happy-dom

import React from "react";
import { vi, describe, it, expect } from "vitest";
import { render, screen } from "test-utils-rtl";
import { createTestClient } from "test-utils";

import { BoostedIndicator } from "./SocialEventTile";
import MatrixClientContext from "../../../../element-web/apps/web/src/contexts/MatrixClientContext";

vi.mock("./PostRelationHeaderLine", () => ({
    PostRelationHeaderLine: ({ text }: { text: React.ReactNode }) => <div data-testid="header-line">{text}</div>,
}));

function renderIndicator(props: Partial<React.ComponentProps<typeof BoostedIndicator>>): HTMLElement {
    render(
        <MatrixClientContext.Provider value={createTestClient()}>
            <BoostedIndicator eventId="$e" roomId="!r:example.org" originalSenderName="Alice" {...props} />
        </MatrixClientContext.Provider>,
    );
    return screen.getByTestId("header-line");
}

describe("BoostedIndicator", () => {
    it("names the original author's post for an ordinary repost", () => {
        expect(renderIndicator({}).textContent).toBe("reposted Alice's post");
    });

    it("names the middle reposter's repost when the target is itself a repost", () => {
        expect(renderIndicator({ targetKind: "repost" }).textContent).toBe("reposted Alice's repost");
    });

    it("bolds the name", () => {
        expect(renderIndicator({}).querySelector("strong")?.textContent).toBe("Alice");
    });

    it.each(["unknown", ""])('says just "reposted" when no real name could be resolved (%j)', (name) => {
        expect(renderIndicator({ originalSenderName: name, targetKind: "repost" }).textContent).toBe("reposted");
    });
});

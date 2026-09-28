/*
 * Social Overlay - UrlPreview loading-state tests
 *
 * A post's link preview is fetched asynchronously, and posts do get scrolled past under
 * Virtuoso's overscan before the fetch resolves. Reserving the thumbnail's own fixed height
 * while loading keeps that resolution from growing the item and moving the feed's scroll
 * position - see the fix's own comment in SocialEventTile.tsx.
 */

// @vitest-environment happy-dom

import React from "react";
import { vi, describe, it, expect } from "vitest";
import { render, screen, waitFor } from "test-utils-rtl";
import { createTestClient } from "test-utils";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { UrlPreview } from "./SocialEventTile";
import MatrixClientContext from "../../../../element-web/apps/web/src/contexts/MatrixClientContext";

function renderPreview(getUrlPreview: MatrixClient["getUrlPreview"]): void {
    const client = createTestClient();
    client.getUrlPreview = getUrlPreview;
    render(
        <MatrixClientContext.Provider value={client}>
            <UrlPreview url="https://example.com/article" ts={12345} />
        </MatrixClientContext.Provider>,
    );
}

describe("UrlPreview", () => {
    it("reserves the thumbnail's height with a placeholder while the fetch is in flight", () => {
        renderPreview(vi.fn<MatrixClient["getUrlPreview"]>().mockReturnValue(new Promise(() => {})));
        const placeholder = document.querySelector(".social_EventTile_urlPreview_loading");
        expect(placeholder).toBeTruthy();
        expect(placeholder).toHaveAttribute("aria-hidden", "true");
    });

    it("replaces the placeholder with the real preview once data arrives", async () => {
        renderPreview(
            vi.fn<MatrixClient["getUrlPreview"]>().mockResolvedValue({
                "og:title": "Example Article",
                "og:description": "A description",
                "og:type": "website",
                "og:url": "https://example.com/article",
            }),
        );
        await waitFor(() => expect(screen.getByText("Example Article")).toBeInTheDocument());
        expect(document.querySelector(".social_EventTile_urlPreview_loading")).toBeNull();
    });

    it("collapses to nothing once the fetch resolves with no usable data", async () => {
        // Real Matrix media_config responses when there's nothing to show still carry the
        // required og:type/og:url fields - just no title/description/image worth rendering.
        renderPreview(
            vi.fn<MatrixClient["getUrlPreview"]>().mockResolvedValue({
                "og:title": "",
                "og:type": "website",
                "og:url": "https://example.com/no-preview",
            }),
        );
        await waitFor(() => expect(document.querySelector(".social_EventTile_urlPreview_loading")).toBeNull());
        expect(document.querySelector(".social_EventTile_urlPreview")).toBeNull();
    });

    it("collapses to nothing if the fetch fails, instead of staying loaded forever", async () => {
        renderPreview(vi.fn<MatrixClient["getUrlPreview"]>().mockRejectedValue(new Error("network error")));
        await waitFor(() => expect(document.querySelector(".social_EventTile_urlPreview_loading")).toBeNull());
        expect(document.querySelector(".social_EventTile_urlPreview")).toBeNull();
    });
});

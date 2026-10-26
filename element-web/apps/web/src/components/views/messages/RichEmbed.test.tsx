/*
 * Haven: tests for rich embeds on links.
 */

// @vitest-environment happy-dom

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { type IPreviewUrlResponse, type MatrixClient } from "matrix-js-sdk/src/matrix";
import { fireEvent, render, screen, waitFor } from "test-utils-rtl";

import { getMockClientWithEventEmitter } from "test-utils";
import MatrixClientContext from "../../../contexts/MatrixClientContext";
import SettingsStore from "../../../settings/SettingsStore";
import { SettingLevel } from "../../../settings/SettingLevel";
import { getRichEmbedTarget } from "../../../utils/richEmbeds";
import { RichEmbed, xEmbedHeight } from "./RichEmbed";

const YOUTUBE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const IMAGE = "https://images.example.org/cat.png";
const options = { parentHost: "localhost", dark: false };

function previewResponse(fields: Record<string, unknown>): IPreviewUrlResponse {
    return fields as unknown as IPreviewUrlResponse;
}

describe("RichEmbed", () => {
    let client: MatrixClient;
    let alwaysSites: string[];

    beforeEach(() => {
        alwaysSites = [];
        client = getMockClientWithEventEmitter({
            getUrlPreview: vi.fn(),
            mxcUrlToHttp: vi.fn((mxc: string) => `https://hs.example.org/media/${mxc.slice(6)}`),
        });
        const getValue = SettingsStore.getValue;
        vi.spyOn(SettingsStore, "getValue").mockImplementation(((name: string, ...rest: unknown[]) =>
            name === "Haven.alwaysEmbedSites"
                ? alwaysSites
                : (getValue as (...args: unknown[]) => unknown)(name, ...rest)) as typeof SettingsStore.getValue);
        vi.spyOn(SettingsStore, "setValue").mockImplementation(async (name, _room, _level, value) => {
            if (name === "Haven.alwaysEmbedSites") alwaysSites = value as string[];
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function renderEmbed(url: string, props: Partial<React.ComponentProps<typeof RichEmbed>> = {}) {
        return render(
            <MatrixClientContext.Provider value={client}>
                <RichEmbed
                    url={url}
                    target={getRichEmbedTarget(url, options)!}
                    ts={1000}
                    renderPreview={(preview) => <div data-testid="card">{String(preview["og:title"])}</div>}
                    loading={<div data-testid="loading" />}
                    {...props}
                />
            </MatrixClientContext.Provider>,
        );
    }

    it("shows the loading placeholder while the server's preview loads", () => {
        vi.mocked(client.getUrlPreview).mockReturnValue(new Promise(() => {}));
        renderEmbed(YOUTUBE);
        expect(screen.getByTestId("loading")).toBeInTheDocument();
    });

    it("shows the server's preview first, with an Embed button", async () => {
        vi.mocked(client.getUrlPreview).mockResolvedValue(previewResponse({ "og:title": "A video" }));
        renderEmbed(YOUTUBE);
        expect(await screen.findByTestId("card")).toHaveTextContent("A video");
        expect(screen.getByRole("button", { name: "Embed from youtube.com" })).toBeInTheDocument();
        expect(screen.getByRole("checkbox", { name: "Always embed links from youtube.com" })).not.toBeChecked();
        expect(document.querySelector("iframe")).toBeNull();
    });

    it("plays the video when Embed is clicked", async () => {
        vi.mocked(client.getUrlPreview).mockResolvedValue(previewResponse({ "og:title": "A video" }));
        renderEmbed(YOUTUBE);
        fireEvent.click(await screen.findByRole("button", { name: "Embed from youtube.com" }));
        const iframe = document.querySelector("iframe")!;
        expect(iframe.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1");
        expect(iframe.getAttribute("referrerpolicy")).toBe("strict-origin-when-cross-origin");
        expect(screen.queryByTestId("card")).toBeNull();
        expect(SettingsStore.setValue).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole("button", { name: "Show preview instead" }));
        expect(screen.getByTestId("card")).toBeInTheDocument();
    });

    it("remembers the site when the box is ticked while embedding", async () => {
        vi.mocked(client.getUrlPreview).mockResolvedValue(previewResponse({ "og:title": "A video" }));
        renderEmbed(YOUTUBE);
        fireEvent.click(await screen.findByRole("checkbox", { name: "Always embed links from youtube.com" }));
        fireEvent.click(screen.getByRole("button", { name: "Embed from youtube.com" }));
        expect(SettingsStore.setValue).toHaveBeenCalledWith(
            "Haven.alwaysEmbedSites",
            null,
            SettingLevel.ACCOUNT,
            ["youtube.com"],
        );
    });

    it("shows the box ticked for an always-embedded site, and unticking it undoes the setting", async () => {
        alwaysSites = ["youtube.com"];
        vi.mocked(client.getUrlPreview).mockResolvedValue(previewResponse({ "og:title": "A video" }));
        renderEmbed(YOUTUBE);
        fireEvent.click(await screen.findByRole("button", { name: "Show preview instead" }));
        const box = await screen.findByRole("checkbox", { name: "Always embed links from youtube.com" });
        expect(box).toBeChecked();
        fireEvent.click(box);
        fireEvent.click(screen.getByRole("button", { name: "Embed from youtube.com" }));
        expect(SettingsStore.setValue).toHaveBeenCalledWith("Haven.alwaysEmbedSites", null, SettingLevel.ACCOUNT, []);
    });

    it("embeds an always-embedded site's links straight away, behind a play cover", () => {
        alwaysSites = ["youtube.com"];
        vi.mocked(client.getUrlPreview).mockReturnValue(new Promise(() => {}));
        renderEmbed(YOUTUBE);
        expect(screen.queryByTestId("loading")).toBeNull();
        const cover = screen.getByRole("button", { name: /^Play/ });
        expect(document.querySelector("iframe")).toBeNull();
        fireEvent.click(cover);
        expect(document.querySelector("iframe")).not.toBeNull();
    });

    it("doesn't embed without a click when media is hidden", () => {
        alwaysSites = ["youtube.com"];
        vi.mocked(client.getUrlPreview).mockResolvedValue(previewResponse({}));
        renderEmbed(YOUTUBE, { autoEmbed: false });
        return waitFor(() => expect(screen.getByRole("button", { name: "Embed from youtube.com" })).toBeInTheDocument());
    });

    it("asks before loading a direct video, which would contact the video's own site", async () => {
        vi.mocked(client.getUrlPreview).mockRejectedValue(new Error("no preview"));
        renderEmbed("https://files.example.org/movie.mp4");
        expect(await screen.findByText("Video from files.example.org")).toBeInTheDocument();
        expect(document.querySelector("video")).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Embed from files.example.org" }));
        expect(document.querySelector("video")).toHaveAttribute("src", "https://files.example.org/movie.mp4");
    });

    it("asks before loading an X post with no server preview", async () => {
        vi.mocked(client.getUrlPreview).mockRejectedValue(new Error("no preview"));
        renderEmbed("https://x.com/alice/status/123");
        expect(await screen.findByText("Post on x.com")).toBeInTheDocument();
        expect(document.querySelector("iframe")).toBeNull();
    });

    it("loads a direct video straight away from an always-embedded site", () => {
        alwaysSites = ["files.example.org"];
        vi.mocked(client.getUrlPreview).mockReturnValue(new Promise(() => {}));
        renderEmbed("https://files.example.org/movie.mp4");
        expect(document.querySelector("video")).not.toBeNull();
    });

    it("shows a linked image from the server's copy of it", async () => {
        vi.mocked(client.getUrlPreview).mockResolvedValue(
            previewResponse({ "og:image": "mxc://hs.example.org/abc", "og:image:type": "image/png" }),
        );
        renderEmbed(IMAGE);
        await waitFor(() =>
            expect(document.querySelector("img.mx_RichEmbed_image")).toHaveAttribute(
                "src",
                "https://hs.example.org/media/hs.example.org/abc",
            ),
        );
    });

    it("asks before loading an image the server has no copy of", async () => {
        renderEmbed(IMAGE, { allowServerPreview: false });
        expect(await screen.findByText("Image from images.example.org")).toBeInTheDocument();
        expect(document.querySelector("img")).toBeNull();
        expect(client.getUrlPreview).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "Embed from images.example.org" }));
        expect(document.querySelector("img.mx_RichEmbed_image")).toHaveAttribute("src", IMAGE);
    });
});

describe("xEmbedHeight", () => {
    it("reads the height from X's resize message", () => {
        const message = {
            "twttr.embed": { method: "twttr.private.resize", params: [{ width: 550, height: 224.5 }] },
        };
        expect(xEmbedHeight(JSON.stringify(message))).toBe(225);
        expect(xEmbedHeight(message)).toBe(225);
    });

    it("ignores other messages", () => {
        expect(xEmbedHeight("not json")).toBeUndefined();
        expect(xEmbedHeight({ "twttr.embed": { method: "twttr.private.rendered" } })).toBeUndefined();
        expect(xEmbedHeight(null)).toBeUndefined();
    });
});

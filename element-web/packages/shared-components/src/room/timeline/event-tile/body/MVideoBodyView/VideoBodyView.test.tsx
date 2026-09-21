/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React from "react";
import { composeStories } from "@storybook/react-vite";
import { fireEvent, render, screen } from "@test-utils";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { MockViewModel } from "../../../../../core/viewmodel/MockViewModel";
import * as stories from "./VideoBodyView.stories";
import {
    VideoBodyView,
    VideoBodyViewState,
    type VideoBodyViewActions,
    type VideoBodyViewSnapshot,
} from "./VideoBodyView";

const { Ready, Hidden, ErrorState } = composeStories(stories);

class TestVideoBodyViewModel extends MockViewModel<VideoBodyViewSnapshot> implements VideoBodyViewActions {
    public onPreviewClick?: VideoBodyViewActions["onPreviewClick"];
    public onPlay?: VideoBodyViewActions["onPlay"];

    public constructor(snapshot: VideoBodyViewSnapshot, actions: VideoBodyViewActions = {}) {
        super(snapshot);
        this.onPreviewClick = actions.onPreviewClick;
        this.onPlay = actions.onPlay;
    }
}

describe("VideoBodyView", () => {
    it.each([
        ["ready", Ready],
        ["hidden", Hidden],
        ["error", ErrorState],
    ])("matches snapshot for %s story", (_name, Story) => {
        const { container } = render(<Story />);
        expect(container).toMatchSnapshot();
    });

    it("renders the hidden preview button and wires the click handler", () => {
        const onPreviewClick = vi.fn();
        const vm = new TestVideoBodyViewModel(
            {
                state: VideoBodyViewState.HIDDEN,
                hiddenButtonLabel: "Show video",
                maxWidth: 320,
                maxHeight: 180,
                aspectRatio: "16/9",
            },
            { onPreviewClick },
        );

        render(<VideoBodyView vm={vm} />);

        fireEvent.click(screen.getByRole("button", { name: "Show video" }));
        expect(onPreviewClick).toHaveBeenCalledTimes(1);
    });

    it("renders a loading spinner while the media is being prepared", () => {
        const vm = new TestVideoBodyViewModel({
            state: VideoBodyViewState.LOADING,
            maxWidth: 320,
            maxHeight: 180,
            aspectRatio: "16/9",
        });

        render(<VideoBodyView vm={vm} />);

        expect(screen.getByRole("progressbar")).toBeInTheDocument();
    });

    it("renders an error message when media processing fails", () => {
        const vm = new TestVideoBodyViewModel({
            state: VideoBodyViewState.ERROR,
            errorLabel: "Error decrypting video",
        });

        render(<VideoBodyView vm={vm} />);

        expect(screen.getByText("Error decrypting video")).toBeInTheDocument();
    });

    it("renders a video element with the expected attributes and file body content", () => {
        const onPlay = vi.fn();
        const vm = new TestVideoBodyViewModel(
            {
                state: VideoBodyViewState.READY,
                videoLabel: "Product demo video",
                maxWidth: 320,
                maxHeight: 180,
                aspectRatio: "16/9",
                src: "https://example.org/demo.mp4",
                poster: "https://example.org/demo-poster.jpg",
                preload: "none",
                controls: true,
                muted: true,
                autoPlay: true,
            },
            { onPlay },
        );

        const videoRef = React.createRef<HTMLVideoElement>();
        render(
            <VideoBodyView vm={vm} videoRef={videoRef}>
                <div>File body slot</div>
            </VideoBodyView>,
        );

        const video = screen.getByLabelText("Product demo video") as HTMLVideoElement;
        expect(video).toHaveStyle({ position: "relative" });
        expect(video).toHaveAttribute("src", "https://example.org/demo.mp4");
        expect(video).toHaveAttribute("poster", "https://example.org/demo-poster.jpg");
        expect(video).toHaveAttribute("preload", "none");
        expect(video).toHaveAttribute("controlslist", "nodownload");
        expect(video).toHaveAttribute("crossorigin", "anonymous");
        expect(video.muted).toBe(true);
        expect(video.autoplay).toBe(true);
        expect(videoRef.current).toBe(video);
        expect(screen.getByText("File body slot")).toBeInTheDocument();

        fireEvent.play(video);
        expect(onPlay).toHaveBeenCalledTimes(1);
    });

    // Haven: regression coverage for the removal of the runtime playback-error overlay. A native
    // <video> `error` event used to be wired through vm.onError to swap the whole player for an
    // "Unable to play video due to error" label - it false-positived (e.g. right after a video
    // played through to the end), so the wiring was dropped. An upstream merge that brings back an
    // onError prop on the <video>, or on VideoBodyViewActions, fails here.
    describe("Haven: no runtime playback-error overlay", () => {
        const readySnapshot: VideoBodyViewSnapshot = {
            state: VideoBodyViewState.READY,
            videoLabel: "Product demo video",
            maxWidth: 320,
            maxHeight: 180,
            aspectRatio: "16/9",
            src: "https://example.org/demo.mp4",
            controls: true,
        };

        it("keeps rendering the video when the <video> element dispatches an error event", () => {
            const vm = new TestVideoBodyViewModel(readySnapshot);
            render(<VideoBodyView vm={vm} />);
            const video = screen.getByLabelText("Product demo video");

            fireEvent.error(video);

            expect(screen.getByLabelText("Product demo video")).toBeInTheDocument();
            expect(screen.getByLabelText("Product demo video")).toBe(video);
            expect(screen.queryByText(/unable to play video/i)).not.toBeInTheDocument();
        });

        it("does not call an onError handler on the view model, even if one is present", () => {
            const vm = new TestVideoBodyViewModel(readySnapshot);
            const onError = vi.fn();
            Object.assign(vm, { onError });
            render(<VideoBodyView vm={vm} />);

            fireEvent.error(screen.getByLabelText("Product demo video"));

            expect(onError).not.toHaveBeenCalled();
        });

        it("has no onError in VideoBodyViewActions", () => {
            expectTypeOf<VideoBodyViewActions>().not.toHaveProperty("onError");
        });
    });
});

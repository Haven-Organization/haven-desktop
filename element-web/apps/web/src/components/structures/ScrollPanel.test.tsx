/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

// @vitest-environment happy-dom

import React from "react";
import { vi, describe, it, expect, afterEach } from "vitest";
import { fireEvent, render } from "test-utils-rtl";

import ScrollPanel from "./ScrollPanel";
import MessagePanel from "./MessagePanel";
import TimelinePanel from "./TimelinePanel";

// Haven: regression coverage for keeping a highlighted event pinned in view. Landing on a message
// from a notification/permalink used to load correctly and then scroll away the moment any other
// tile's media (an image, a link preview) finished loading and changed height: saveScrollState()
// re-derives its anchor as "whichever message is bottom-most in the viewport" on every scroll
// event - including the corrective scrollBy() updateHeight() issues when other tiles resize - so
// the anchor silently moved off the highlighted event. scrollToToken() now takes a `sticky` flag
// (set only by TimelinePanel's "jump to this event" path) that pins the anchor until the user's own
// next wheel/touch scroll. An upstream merge that drops any link in ScrollPanel -> MessagePanel ->
// TimelinePanel fails here.

// happy-dom has no layout engine (every offset/height is 0), so this fakes the geometry the
// scroll-anchor maths reads: three messages stacked 100px apart in a 300px list, viewed through a
// 100px window. Jumping to $c scrolls the window down to it; the tests then move the window back
// to the top (see shiftContentUnderViewport) the way another tile growing above it would, at which
// point the "bottom-most message in the viewport" re-pick lands on the FIRST message ($a) - which
// is what tells a pinned anchor ($c) apart from an ordinary re-picked one.
const MESSAGE_OFFSETS: Record<string, number> = { $a: 0, $b: 100, $c: 200 };

function defineGetters(el: Element, values: Record<string, number>): void {
    for (const [prop, value] of Object.entries(values)) {
        Object.defineProperty(el, prop, { configurable: true, value });
    }
}

// The private surface these tests reach into; ScrollPanel keeps all of it private.
interface ScrollPanelInternals {
    stickyScrollToken: string | null;
    scrollState: { trackedScrollToken?: string; trackedNode?: HTMLElement };
    saveScrollState(): void;
}

// Stands in for another tile above/around the highlighted event changing height: the content the
// viewport was showing shifts, so the viewport is suddenly looking at a different part of the list.
function shiftContentUnderViewport(scrollDiv: HTMLElement): void {
    scrollDiv.scrollTop = 0;
}

describe("ScrollPanel sticky highlighted-event anchoring", () => {
    const messages = (tokens: string[]): React.ReactNode =>
        tokens.map((token) => (
            <li key={token} data-scroll-tokens={token}>
                {token}
            </li>
        ));

    function renderPanel(tokens = ["$a", "$b", "$c"]): {
        panel: ScrollPanel;
        internals: ScrollPanelInternals;
        scrollDiv: HTMLElement;
        rerenderWith: (tokens: string[]) => void;
    } {
        const ref = React.createRef<ScrollPanel>();
        const ui = (t: string[]): React.ReactElement => (
            <ScrollPanel ref={ref} stickyBottom={false} startAtBottom={false}>
                {messages(t)}
            </ScrollPanel>
        );
        const { container, rerender } = render(ui(tokens));

        const panel = ref.current!;
        const scrollDiv = container.querySelector<HTMLElement>(".mx_ScrollPanel")!;
        const list = container.querySelector<HTMLElement>("ol.mx_RoomView_MessageList")!;

        defineGetters(scrollDiv, { scrollHeight: 300, clientHeight: 100 });
        defineGetters(list, { clientHeight: 300 });
        const applyMessageGeometry = (): void => {
            for (const li of container.querySelectorAll<HTMLElement>("li[data-scroll-tokens]")) {
                defineGetters(li, { offsetTop: MESSAGE_OFFSETS[li.dataset.scrollTokens!] });
            }
        };
        applyMessageGeometry();

        return {
            panel,
            internals: panel as unknown as ScrollPanelInternals,
            scrollDiv,
            rerenderWith: (t) => {
                rerender(ui(t));
                applyMessageGeometry();
            },
        };
    }

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("scrollToToken(..., sticky) pins the token so saveScrollState() keeps tracking it", () => {
        const { panel, internals, scrollDiv } = renderPanel();

        panel.scrollToToken("$c", 0, 0, true);

        expect(internals.stickyScrollToken).toBe("$c");
        expect(internals.scrollState.trackedScrollToken).toBe("$c");

        // e.g. another tile's image finishing loading - a fresh save must still protect $c
        // instead of re-picking whatever the viewport is now looking at.
        shiftContentUnderViewport(scrollDiv);
        internals.saveScrollState();
        expect(internals.scrollState.trackedScrollToken).toBe("$c");
        expect(internals.scrollState.trackedNode?.dataset.scrollTokens).toBe("$c");
    });

    it("without sticky, the same jump is re-picked as the bottom-most message in the viewport", () => {
        const { panel, internals, scrollDiv } = renderPanel();

        panel.scrollToToken("$c", 0, 0);
        expect(internals.stickyScrollToken).toBeNull();
        expect(internals.scrollState.trackedScrollToken).toBe("$c");

        // the control case: proves the geometry above really would move an unpinned anchor
        shiftContentUnderViewport(scrollDiv);
        internals.saveScrollState();
        expect(internals.scrollState.trackedScrollToken).toBe("$a");
    });

    it("keeps the pin across native scroll events (what loading media triggers)", () => {
        const { panel, internals, scrollDiv } = renderPanel();
        panel.scrollToToken("$c", 0, 0, true);

        shiftContentUnderViewport(scrollDiv);
        fireEvent.scroll(scrollDiv);
        fireEvent.scroll(scrollDiv);

        expect(internals.stickyScrollToken).toBe("$c");
        expect(internals.scrollState.trackedScrollToken).toBe("$c");
    });

    it.each([
        ["wheel", (el: HTMLElement) => fireEvent.wheel(el)],
        ["touchstart", (el: HTMLElement) => fireEvent.touchStart(el)],
    ])("releases the pin on the user's own %s, so normal tracking resumes", (_name, userInput) => {
        const { panel, internals, scrollDiv } = renderPanel();
        panel.scrollToToken("$c", 0, 0, true);
        shiftContentUnderViewport(scrollDiv);

        userInput(scrollDiv);

        expect(internals.stickyScrollToken).toBeNull();
        fireEvent.scroll(scrollDiv);
        expect(internals.scrollState.trackedScrollToken).toBe("$a");
    });

    it("releases the pin when the pinned event is no longer rendered", () => {
        const { panel, internals, scrollDiv, rerenderWith } = renderPanel();
        panel.scrollToToken("$c", 0, 0, true);
        shiftContentUnderViewport(scrollDiv);

        rerenderWith(["$a", "$b"]);
        fireEvent.scroll(scrollDiv);

        expect(internals.stickyScrollToken).toBeNull();
        expect(internals.scrollState.trackedScrollToken).toBe("$a");
    });

    it("a later non-sticky scrollToToken (e.g. the read-marker jump) replaces an earlier pin", () => {
        const { panel, internals } = renderPanel();
        panel.scrollToToken("$c", 0, 0, true);
        expect(internals.stickyScrollToken).toBe("$c");

        panel.scrollToToken("$b", 0, 1 / 3);

        expect(internals.stickyScrollToken).toBeNull();
    });

    it("never pins when sticky is omitted", () => {
        const { panel, internals } = renderPanel();

        panel.scrollToToken("$c");
        panel.scrollToToken("$b", 5, 0.5);

        expect(internals.stickyScrollToken).toBeNull();
    });
});

describe("sticky flag plumbing above ScrollPanel", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("MessagePanel.scrollToEvent forwards the sticky flag to ScrollPanel.scrollToToken", () => {
        const scrollToToken = vi.fn();
        const fakeThis = { scrollPanel: { current: { scrollToToken } } };

        MessagePanel.prototype.scrollToEvent.call(fakeThis as any, "$event", 12, 0.3, true);
        expect(scrollToToken).toHaveBeenLastCalledWith("$event", 12, 0.3, true);

        MessagePanel.prototype.scrollToEvent.call(fakeThis as any, "$event", 12, 0.3);
        expect(scrollToToken).toHaveBeenLastCalledWith("$event", 12, 0.3, undefined);
    });

    it("TimelinePanel's jump-to-event path scrolls with sticky: true, before and after the next frame", () => {
        const frames: FrameRequestCallback[] = [];
        vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
        const scrollToEvent = vi.fn();
        const scrollToBottom = vi.fn();
        const fakeThis = { props: {}, messagePanel: { current: { scrollToEvent, scrollToBottom } } };

        (TimelinePanel.prototype as any).scrollIntoView.call(fakeThis, "$event", 12, 0.3);
        expect(scrollToEvent).toHaveBeenCalledTimes(1);
        expect(scrollToEvent).toHaveBeenLastCalledWith("$event", 12, 0.3, true);

        // the second, post-render attempt has to be sticky too
        frames.splice(0).forEach((cb) => cb(0));
        expect(scrollToEvent).toHaveBeenCalledTimes(2);
        expect(scrollToEvent).toHaveBeenLastCalledWith("$event", 12, 0.3, true);
        expect(scrollToBottom).not.toHaveBeenCalled();
    });

    it("TimelinePanel scrolls to the bottom, not to an event, when there's no event to focus", () => {
        vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => cb(0));
        const scrollToEvent = vi.fn();
        const scrollToBottom = vi.fn();
        const fakeThis = { props: {}, messagePanel: { current: { scrollToEvent, scrollToBottom } } };

        (TimelinePanel.prototype as any).scrollIntoView.call(fakeThis, undefined);

        expect(scrollToEvent).not.toHaveBeenCalled();
        expect(scrollToBottom).toHaveBeenCalled();
    });
});

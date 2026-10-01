/*
 * Social Overlay - holdScrollPosition tests
 *
 * Regression coverage for "the Feed still jumps sometimes when I press Repost" - see
 * holdScrollPosition.ts.
 */

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { holdScrollPosition } from "./holdScrollPosition";

/** A .social_Content scroller with a button inside whose on-screen top is controlled by `top`. */
function setUp(): { scroller: HTMLElement; button: HTMLElement; setTop: (top: number) => void } {
    const scroller = document.createElement("div");
    scroller.className = "social_Content";
    const button = document.createElement("button");
    scroller.appendChild(button);
    document.body.appendChild(scroller);
    let top = 500;
    vi.spyOn(button, "getBoundingClientRect").mockImplementation(() => ({ top }) as DOMRect);
    // Scrolling the container moves the button by the same amount the other way, as in a browser.
    let scrollTop = 0;
    Object.defineProperty(scroller, "scrollTop", {
        get: () => scrollTop,
        set: (value: number) => {
            top -= value - scrollTop;
            scrollTop = value;
        },
    });
    return { scroller, button, setTop: (t) => (top = t) };
}

describe("holdScrollPosition", () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    });

    afterEach(() => {
        vi.useRealTimers();
        document.body.innerHTML = "";
    });

    it("scrolls by however far the element moved, putting it back in place", () => {
        const { scroller, button, setTop } = setUp();
        holdScrollPosition(button, new Promise(() => {}));

        setTop(530); // something above grew by 30px
        vi.advanceTimersToNextFrame();

        expect(scroller.scrollTop).toBe(30);
        expect(button.getBoundingClientRect().top).toBe(500);
    });

    it("stops holding once the user scrolls themselves", () => {
        const { scroller, button, setTop } = setUp();
        holdScrollPosition(button, new Promise(() => {}));

        window.dispatchEvent(new Event("wheel"));
        setTop(700);
        vi.advanceTimersToNextFrame();

        expect(scroller.scrollTop).toBe(0);
    });

    it("stops holding a while after the action settles", async () => {
        const { scroller, button, setTop } = setUp();
        holdScrollPosition(button, Promise.resolve());
        await Promise.resolve(); // let the settle handler run

        vi.advanceTimersByTime(2000);
        setTop(560);
        vi.advanceTimersToNextFrame();

        expect(scroller.scrollTop).toBe(0);
    });

    it("does nothing outside a .social_Content scroller", () => {
        const button = document.createElement("button");
        document.body.appendChild(button);
        expect(() => holdScrollPosition(button, Promise.resolve())).not.toThrow();
    });
});

/*
 * Social Overlay - holdScrollPosition
 *
 * Keeps an element (e.g. the Repost button that was just pressed) at the same spot on screen while
 * the action it started settles, by scrolling its scroll container by however far it moved.
 *
 * Pressing Repost changes the Feed in several ways at once: the repost itself appears at the top,
 * a 🔁 reaction lands on the original post (adding a whole reaction row above its buttons when it
 * had none, growing that post - and with its top scrolled off-screen, pushing everything in view
 * down), and the repost's local echo is later replaced by the server's copy under a new event id.
 * The Feed's list (react-virtuoso) compensates for some of these but not reliably all of them, so
 * the button jumped "sometimes" even after its top-of-list case was handled (see firstItemIndex in
 * SocialHomeView.tsx). Measuring where the pressed element actually ends up and correcting for it
 * covers every one of those causes, including any not anticipated here.
 *
 * Stops early on anything that means the user is moving the page themselves (wheel, touch, key,
 * pointer press), so it never fights a deliberate scroll.
 */

/** How long to keep holding after the action finishes - long enough for its own local echo/remote
 *  echo re-renders and any image in the new top post to settle. */
const SETTLE_MS = 1500;
/** Absolute ceiling, in case the action never settles. */
const MAX_HOLD_MS = 6000;

const USER_INPUT_EVENTS = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

/**
 * Holds `element` at its current on-screen position until `work` settles (plus SETTLE_MS), by
 * adjusting the nearest `.social_Content` scroll container. No-op if there's no such container.
 */
export function holdScrollPosition(element: HTMLElement, work: Promise<unknown>): void {
    const scroller = element.closest<HTMLElement>(".social_Content");
    if (!scroller) return;

    const startTop = element.getBoundingClientRect().top;
    const startedAt = performance.now();
    let stopAt = startedAt + MAX_HOLD_MS;
    let stopped = false;
    let frame = 0;

    const stop = (): void => {
        if (stopped) return;
        stopped = true;
        cancelAnimationFrame(frame);
        for (const type of USER_INPUT_EVENTS) window.removeEventListener(type, stop, true);
    };
    for (const type of USER_INPUT_EVENTS) window.addEventListener(type, stop, { capture: true, passive: true });

    const settle = (): void => {
        stopAt = Math.min(stopAt, performance.now() + SETTLE_MS);
    };
    void work.then(settle, settle);

    const tick = (): void => {
        // The element itself was replaced or scrolled out of the rendered window - nothing left to
        // hold in place.
        if (stopped || !element.isConnected) return stop();
        const drift = element.getBoundingClientRect().top - startTop;
        if (Math.abs(drift) >= 1) scroller.scrollTop += drift;
        if (performance.now() >= stopAt) return stop();
        frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
}

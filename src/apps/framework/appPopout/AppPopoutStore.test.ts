// @vitest-environment happy-dom
// Haven: popping an app out into its own window - opening it, drawing into it, and closing it again.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Modal from "../../../../element-web/apps/web/src/Modal";
import { AppPopoutStore, APP_POPOUT_PAGE, APP_POPOUT_WINDOW_NAME_PREFIX } from "./AppPopoutStore";
import { getDialogWindow, setDialogWindowResolver } from "./dialogWindow";

interface FakePopup {
    closed: boolean;
    document: Document;
    location: { pathname: string };
    focus: ReturnType<typeof vi.fn>;
    close: () => void;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
}

function fakePopup(pathname = `/${APP_POPOUT_PAGE}`): FakePopup {
    const popup: FakePopup = {
        closed: false,
        document: document.implementation.createHTMLDocument("pop-out"),
        location: { pathname },
        focus: vi.fn(),
        close: () => {
            popup.closed = true;
        },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    };
    Object.defineProperty(popup.document, "readyState", { value: "complete" });
    return popup;
}

describe("AppPopoutStore", () => {
    let popup: FakePopup;
    let open: ReturnType<typeof vi.fn<typeof window.open>>;
    let store: AppPopoutStore;

    beforeEach(() => {
        vi.useFakeTimers();
        popup = fakePopup();
        open = vi.fn<typeof window.open>().mockReturnValue(popup as unknown as Window);
        vi.spyOn(window, "open").mockImplementation(open);
        vi.spyOn(Modal, "havenReturnDialogsFrom").mockImplementation(() => {});
        store = new AppPopoutStore(window);
    });

    afterEach(() => {
        store.popIn();
        setDialogWindowResolver(null);
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("opens the pop-out page in a window named for the app and draws the app into it", async () => {
        const listener = vi.fn();
        store.subscribe(listener);

        await expect(store.popOut("social", 800, 600)).resolves.toEqual({ ok: true });

        expect(open).toHaveBeenCalledWith(
            expect.stringContaining(APP_POPOUT_PAGE),
            `${APP_POPOUT_WINDOW_NAME_PREFIX}social`,
            "popup=yes,width=800,height=600",
        );
        expect(store.isPoppedOut("social")).toBe(true);
        expect(store.popout?.container.parentElement).toBe(popup.document.body);
        expect(listener).toHaveBeenCalled();
    });

    it("copies the main window's stylesheets and theme classes into the pop-out", async () => {
        const style = document.createElement("style");
        style.textContent = ".haven_test { color: red; }";
        document.head.appendChild(style);
        document.documentElement.className = "cpd-theme-dark";

        await store.popOut("social", 800, 600);

        expect(popup.document.head.textContent).toContain(".haven_test");
        expect(popup.document.documentElement.className).toBe("cpd-theme-dark");
        style.remove();
        document.documentElement.className = "";
    });

    it("focuses the existing window instead of opening another for the same app", async () => {
        await store.popOut("social", 800, 600);
        await expect(store.popOut("social", 800, 600)).resolves.toEqual({ ok: true });

        expect(open).toHaveBeenCalledTimes(1);
        expect(popup.focus).toHaveBeenCalled();
    });

    it("reports a refused window", async () => {
        open.mockReturnValue(null);

        const result = await store.popOut("social", 800, 600);

        expect(result.ok).toBe(false);
        expect(store.popout).toBeNull();
    });

    it("gives up if the window is closed before its page loads", async () => {
        popup.location.pathname = "/about:blank";
        const result = store.popOut("social", 800, 600);
        popup.closed = true;
        await vi.advanceTimersByTimeAsync(100);

        await expect(result).resolves.toEqual({ ok: false, reason: "The window closed before it loaded." });
    });

    it("closes the window and returns its dialogs to the main window on pop-in", async () => {
        await store.popOut("social", 800, 600);
        const listener = vi.fn();
        store.subscribe(listener);

        store.popIn();

        expect(popup.closed).toBe(true);
        expect(store.popout).toBeNull();
        expect(Modal.havenReturnDialogsFrom).toHaveBeenCalledWith(popup);
        expect(listener).toHaveBeenCalled();
    });

    it("pops back in when the user closes the window", async () => {
        await store.popOut("social", 800, 600);

        popup.closed = true;
        await vi.advanceTimersByTimeAsync(1000);

        expect(store.popout).toBeNull();
    });

    it("opens dialogs in the pop-out only while it has focus", async () => {
        await store.popOut("social", 800, 600);
        const hasFocus = vi.spyOn(popup.document, "hasFocus");

        hasFocus.mockReturnValue(true);
        expect(getDialogWindow()).toBe(popup);

        hasFocus.mockReturnValue(false);
        expect(getDialogWindow()).toBe(window);
    });
});

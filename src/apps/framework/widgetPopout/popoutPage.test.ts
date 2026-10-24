/*
 * Haven - widget pop-out page tests
 */

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, vi } from "vitest";

import { runPopoutPage } from "./popoutPage";
import { POPOUT_MESSAGE_KEY as K } from "./protocol";

const ORIGIN = "https://haven.example.org";

class FakePopupWindow extends EventTarget {
    public location = { origin: ORIGIN };
    public constructor(
        public document: Document,
        public opener: { closed: boolean; postMessage: ReturnType<typeof vi.fn> } | null,
    ) {
        super();
    }
}

function message(win: FakePopupWindow, data: unknown, source: unknown, origin = ORIGIN): void {
    win.dispatchEvent(Object.assign(new Event("message"), { data, source, origin }));
}

describe("runPopoutPage", () => {
    let opener: { closed: boolean; postMessage: ReturnType<typeof vi.fn> };
    let win: FakePopupWindow;

    beforeEach(() => {
        document.body.innerHTML = "";
        opener = { closed: false, postMessage: vi.fn() };
        win = new FakePopupWindow(document, opener);
        runPopoutPage(win as unknown as Window);
    });

    it("tells Haven's main window it's ready", () => {
        expect(opener.postMessage).toHaveBeenCalledWith({ [K]: "ready" }, ORIGIN);
    });

    it("loads the widget it's given", () => {
        message(
            win,
            {
                [K]: "load",
                src: "about:blank",
                title: "CrappyBird",
                allow: "autoplay;",
                sandbox: "allow-scripts",
                background: "black",
            },
            opener,
        );
        const frame = document.querySelector("iframe")!;
        expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
        expect(frame.allow).toBe("autoplay;");
        expect(document.title).toBe("CrappyBird");
    });

    it("takes orders only from Haven's own main window", () => {
        const load = { [K]: "load", src: "about:blank", title: "x", allow: "", sandbox: "", background: "" };
        message(win, load, {});
        message(win, load, opener, "https://evil.example.org");
        expect(document.querySelector("iframe")).toBeNull();
    });

    it("relays the widget's messages to the main window, and the main window's to the widget", () => {
        message(win, { [K]: "load", src: "about:blank", title: "x", allow: "", sandbox: "", background: "" }, opener);
        const frame = document.querySelector("iframe")!;
        const widgetWindow = frame.contentWindow!;

        message(win, { api: "fromWidget", action: "get_openid" }, widgetWindow, "https://widget.example.org");
        expect(opener.postMessage).toHaveBeenLastCalledWith(
            { [K]: "in", data: { api: "fromWidget", action: "get_openid" } },
            ORIGIN,
        );

        const post = vi.spyOn(widgetWindow, "postMessage").mockImplementation(() => {});
        message(win, { [K]: "out", data: { api: "toWidget" }, targetOrigin: "https://widget.example.org" }, opener);
        expect(post).toHaveBeenCalledWith({ api: "toWidget" }, "https://widget.example.org");
    });

    it("tells the main window when it closes", () => {
        win.dispatchEvent(new Event("pagehide"));
        expect(opener.postMessage).toHaveBeenLastCalledWith({ [K]: "closing" }, ORIGIN);
    });
});

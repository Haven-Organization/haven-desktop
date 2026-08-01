// @vitest-environment happy-dom
// Haven: regression coverage for the J/K-in-Radix-menus interop (see this module's own doc) -
// guards against an upstream element-web merge changing RovingTabIndex.tsx's jkArrowEquivalent
// signature/behaviour in a way this module silently stops working with, and pins down the exact
// scoping rules (menu-only, never in a text input, no modifiers) that make this safe to have
// installed globally for the whole app's lifetime.
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { installJKMenuNavigation, uninstallJKMenuNavigation } from "./jkMenuNavigation";

function mkKeydown(key: string, opts: Partial<KeyboardEventInit> = {}): KeyboardEvent {
    return new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
}

describe("jkMenuNavigation", () => {
    beforeEach(() => {
        installJKMenuNavigation();
    });

    afterEach(() => {
        uninstallJKMenuNavigation();
        document.body.innerHTML = "";
    });

    function mkMenuItem(): HTMLElement {
        const menu = document.createElement("div");
        menu.setAttribute("role", "menu");
        const item = document.createElement("div");
        item.setAttribute("role", "menuitem");
        menu.appendChild(item);
        document.body.appendChild(menu);
        return item;
    }

    it("translates a plain 'j' on a menuitem into a synthetic ArrowDown on the same target", () => {
        const item = mkMenuItem();
        const seen: string[] = [];
        item.addEventListener("keydown", (e) => seen.push(e.key));

        const original = mkKeydown("j");
        item.dispatchEvent(original);

        expect(original.defaultPrevented).toBe(true);
        // The real 'j' itself never reaches the target's own listener - the window-level capture
        // handler calls stopPropagation() before the event gets that far, same as it would for a
        // real user keypress. Only the freshly-dispatched synthetic ArrowDown does.
        expect(seen).toEqual(["ArrowDown"]);
    });

    it("translates a plain 'k' on a menuitem into a synthetic ArrowUp on the same target", () => {
        const item = mkMenuItem();
        const seen: string[] = [];
        item.addEventListener("keydown", (e) => seen.push(e.key));

        item.dispatchEvent(mkKeydown("k"));

        expect(seen).toEqual(["ArrowUp"]);
    });

    it("leaves 'j'/'k' alone outside any menu", () => {
        const div = document.createElement("div");
        document.body.appendChild(div);
        const seen: string[] = [];
        div.addEventListener("keydown", (e) => seen.push(e.key));

        const original = mkKeydown("j");
        div.dispatchEvent(original);

        expect(original.defaultPrevented).toBe(false);
        expect(seen).toEqual(["j"]);
    });

    it("never intercepts inside a real text input, even one nested in an open menu", () => {
        const menu = document.createElement("div");
        menu.setAttribute("role", "menu");
        const input = document.createElement("input");
        menu.appendChild(input);
        document.body.appendChild(menu);
        const seen: string[] = [];
        input.addEventListener("keydown", (e) => seen.push(e.key));

        const original = mkKeydown("j");
        input.dispatchEvent(original);

        expect(original.defaultPrevented).toBe(false);
        expect(seen).toEqual(["j"]);
    });

    it("leaves a real ArrowDown/ArrowUp press alone (nothing to translate)", () => {
        const item = mkMenuItem();
        const seen: string[] = [];
        item.addEventListener("keydown", (e) => seen.push(e.key));

        const original = mkKeydown("ArrowDown");
        item.dispatchEvent(original);

        expect(original.defaultPrevented).toBe(false);
        expect(seen).toEqual(["ArrowDown"]);
    });

    it("does not intercept when a modifier is held alongside j/k", () => {
        const item = mkMenuItem();
        const seen: string[] = [];
        item.addEventListener("keydown", (e) => seen.push(e.key));

        const original = mkKeydown("j", { ctrlKey: true });
        item.dispatchEvent(original);

        expect(original.defaultPrevented).toBe(false);
        expect(seen).toEqual(["j"]);
    });

    it("stops intercepting once uninstalled", () => {
        const item = mkMenuItem();
        uninstallJKMenuNavigation();
        const seen: string[] = [];
        item.addEventListener("keydown", (e) => seen.push(e.key));

        const original = mkKeydown("j");
        item.dispatchEvent(original);

        expect(original.defaultPrevented).toBe(false);
        expect(seen).toEqual(["j"]);
    });
});

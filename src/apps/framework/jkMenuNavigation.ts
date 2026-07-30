/*
 * Haven apps-framework patch
 *
 * Lets J/K stand in for Down/Up inside menus built on @vector-im/compound-web's <Menu> (e.g. the
 * user menu's "Link new device" / "Security & Privacy" / "All settings" list). Those are Radix
 * DropdownMenu-based and own their arrow-key handling entirely internally - they never go through
 * KeyBindingsManager or RovingTabIndex, so RovingTabIndex.tsx's own jkArrowEquivalent (which only
 * reaches Haven/Element's own roving-tabindex components) never sees these keydowns at all.
 *
 * A capture-phase window listener intercepts the real 'j'/'k' keydown before Radix's own listener
 * gets a chance, and re-dispatches a synthetic ArrowDown/ArrowUp keydown from the same target so
 * Radix's internal focus-movement logic runs exactly as if the real arrow key had been pressed.
 * Scoped to elements inside an actual open Radix menu (role="menu"/"menuitem", which Radix sets
 * unconditionally) so it never intercepts J/K typed anywhere else.
 */

import { jkArrowEquivalent } from "../../../element-web/apps/web/src/accessibility/RovingTabIndex";

function onKeyDown(ev: KeyboardEvent): void {
    const arrowKey = jkArrowEquivalent(ev);
    if (!arrowKey) return;

    const target = ev.target as HTMLElement | null;
    if (!target || target.closest("input, textarea, select, [contenteditable=true]")) return;
    if (!target.closest('[role="menu"], [role="menuitem"]')) return;

    ev.preventDefault();
    ev.stopPropagation();
    target.dispatchEvent(new KeyboardEvent("keydown", { key: arrowKey, code: arrowKey, bubbles: true, cancelable: true }));
}

export function installJKMenuNavigation(): void {
    window.addEventListener("keydown", onKeyDown, true);
}

export function uninstallJKMenuNavigation(): void {
    window.removeEventListener("keydown", onKeyDown, true);
}

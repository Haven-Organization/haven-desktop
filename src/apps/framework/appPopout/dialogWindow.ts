/*
 * Haven - which window a dialog opens in.
 *
 * Element opens dialogs through one manager (Modal.tsx), called from anywhere, so a dialog can't
 * tell from the code that opened it which window it belongs to. An app popped out into its own
 * window (AppPopoutStore.ts) answers here: while that window has focus - as it does when the user
 * clicked something in it - dialogs open there.
 */

type DialogWindowResolver = () => Window | null;

let resolver: DialogWindowResolver | null = null;

export function setDialogWindowResolver(fn: DialogWindowResolver | null): void {
    resolver = fn;
}

/** The window a dialog opened now should go in. */
export function getDialogWindow(): Window {
    return resolver?.() ?? window;
}

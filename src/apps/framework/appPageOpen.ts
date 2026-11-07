/*
 * Haven framework — appPageOpen
 *
 * Whether MatrixChat's main page is a Haven app (e.g. Social) rather than a room or another stock
 * page. Kept here because MatrixChat's page_type lives only in its own state, and stock code being
 * unmounted by the switch to an app needs to know why it is going away. ThreadView is the case
 * that needs it: closing a thread that was opened at an event re-views its room, which pulled the
 * user straight back out of the app they had just opened.
 */
let appPageOpen = false;

/** Called by MatrixChat whenever it changes its page, before the new page renders. */
export function noteAppPageOpen(open: boolean): void {
    appPageOpen = open;
}

export function isAppPageOpen(): boolean {
    return appPageOpen;
}

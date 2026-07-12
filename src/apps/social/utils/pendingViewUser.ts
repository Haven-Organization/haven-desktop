/**
 * Bridges "view this user's Social profile" clicks that originate outside Social (e.g. the stock
 * member RightPanel's Profile button — see SocialProfileButton.tsx) into SocialHomeView, which
 * doesn't exist in the DOM yet at click time if Social isn't already open.
 *
 * A dispatched action can't carry state to a component that hasn't mounted yet to register its
 * listener — by the time SOCIAL_HOME_ACTION causes SocialHomeView to mount, the dispatch that
 * triggered it has already fired. This plain module-level value sidesteps that: the click handler
 * sets it and *then* dispatches SOCIAL_HOME_ACTION; SocialHomeView reads and clears it once, in a
 * mount effect, and feeds it through the exact same handleViewUser resolution (linked profile room
 * vs placeholder page) that a click on a user pill inside Social already uses.
 */
let pendingViewUserId: string | null = null;

export function setPendingViewUserId(userId: string): void {
    pendingViewUserId = userId;
}

export function consumePendingViewUserId(): string | null {
    const id = pendingViewUserId;
    pendingViewUserId = null;
    return id;
}

/** Non-destructive read - lets a component's own initial-state computation know a resolution is
 *  about to happen (see SocialHomeView's resolvingPendingUser) without consuming the value itself,
 *  which the real mount effect still needs to do exactly once. */
export function peekPendingViewUserId(): string | null {
    return pendingViewUserId;
}

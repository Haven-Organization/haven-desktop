/*
 * Social Overlay — pendingFeedThread
 *
 * Same bridge pattern as pendingViewPost.ts, but specifically for "reopen this exact post's thread
 * within the aggregated Feed's own panel" - as opposed to pendingViewPost's "go to this room's
 * dedicated Social page", which is what every *other* way of reaching a post (matrix.to links,
 * fresh navigation) means. The two produce the identical "social/room/!id/$eventId" hash (see
 * routing.ts's tryRouteSocialHashScreen and its own history.state-based origin tracking), so this
 * only ever gets set when back/forward specifically lands on a hash whose history entry was
 * stamped "socialOrigin: feed" - the one case where the dedicated room page would be the *wrong*
 * restoration and the Feed's own thread panel is what the user actually had open before.
 */

export interface PendingFeedThread {
    roomId: string;
    eventId: string;
}

let pendingFeedThread: PendingFeedThread | null = null;

export function setPendingFeedThread(roomId: string, eventId: string): void {
    pendingFeedThread = { roomId, eventId };
}

export function consumePendingFeedThread(): PendingFeedThread | null {
    const p = pendingFeedThread;
    pendingFeedThread = null;
    return p;
}

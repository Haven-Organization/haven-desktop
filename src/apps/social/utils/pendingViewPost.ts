/*
 * Social Overlay — pendingViewPost
 *
 * Same bridge as pendingViewUser.ts (see there for the full explanation of why a plain module value
 * is needed at all), just for "go to this room/post" instead of "go to this user's profile" -
 * used by permalinkRouting.ts to hand a matrix.to/matrix: link's target off to SocialHomeView once
 * SOCIAL_HOME_ACTION causes it to mount.
 */

export interface PendingViewPost {
    roomId: string;
    eventId?: string;
}

let pendingViewPost: PendingViewPost | null = null;

export function setPendingViewPost(roomId: string, eventId?: string): void {
    pendingViewPost = { roomId, eventId };
}

export function consumePendingViewPost(): PendingViewPost | null {
    const p = pendingViewPost;
    pendingViewPost = null;
    return p;
}

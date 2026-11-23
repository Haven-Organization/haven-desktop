/*
 * Haven - message translation: a message's mentions as names, for sending to a translation site.
 * A Matrix ID such as "@claude:glowers.club" looks like a web address to the site, which then
 * mangles the whole sentence ("followers.club"); a plain name reads as one.
 */

import { type Room } from "matrix-js-sdk/src/matrix";

/** A user ID (@localpart:server, with an optional port). */
const USER_ID = /@([a-z0-9._=\-/+]+):[a-z0-9.-]+(?::\d+)?/gi;

/**
 * `text` with each user ID replaced by that user's display name in `room` (what the mention's pill
 * shows), or by the ID's localpart when the room doesn't have them.
 */
export function mentionsAsNames(text: string, room: Room | null | undefined): string {
    return text.replace(USER_ID, (userId: string, localpart: string) => {
        const name = room?.getMember(userId)?.rawDisplayName;
        return name && name !== userId ? name : localpart;
    });
}

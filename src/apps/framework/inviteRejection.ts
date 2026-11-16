/*
 * Haven - invite rejections that always stick, without error dialogs.
 *
 * Rejecting an invite is a /leave on the room. When the invite is already gone on the server (the
 * inviter withdrew it, or it was rejected from another device) but that never reached this client,
 * the /leave fails with a 4xx and stock Element shows the error and keeps the invite in the list
 * for good: the sync data cached in IndexedDB still has it, so even a reload brings it back. Only
 * "Clear cache and reload" got rid of it.
 *
 * None of those errors are anything the user can act on, so rejectInvite() never shows one. The
 * invite is removed locally straight away, in memory and from the sync cache, so it stays gone.
 * Then:
 * - a 4xx means the server doesn't have us invited any more, so there is nothing left to do;
 * - anything else (the server or the network failing, rate limiting) is retried in the background
 *   until the server takes the rejection.
 */

import { type MatrixClient, KnownMembership, MatrixError } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";
import { safeGetRetryAfterMs } from "matrix-js-sdk/src/http-api/errors";

import { markPendingLeave } from "../social/utils/pendingRoomLeave";

/** Delays between background retries; the last one repeats until it works or the page closes. */
export const RETRY_DELAYS_MS = [5_000, 30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000];

const retrying = new Set<string>();

/**
 * Whether a failed /leave on an invite means the server no longer has us invited. Any 4xx does,
 * except the ones that say something about this session instead: rate limiting, a logged-out
 * session, or terms of service still to be accepted.
 */
export function isStaleInviteError(error: unknown): error is MatrixError {
    if (!(error instanceof MatrixError)) return false;
    const status = error.httpStatus ?? 0;
    if (status < 400 || status >= 500 || status === 401 || status === 429) return false;
    return error.errcode !== "M_LIMIT_EXCEEDED" && error.errcode !== "M_CONSENT_NOT_GIVEN";
}

function describe(error: unknown): string {
    if (error instanceof MatrixError) return `${error.httpStatus} ${error.errcode}: ${error.message}`;
    return error instanceof Error ? error.message : String(error);
}

/** Rejects the invite to `roomId`. Never throws: the invite is gone from the user's view either way. */
export async function rejectInvite(client: MatrixClient, roomId: string): Promise<void> {
    let failure: unknown = null;
    try {
        await client.leave(roomId);
    } catch (error) {
        failure = error;
    }
    await dropInviteLocally(client, roomId);
    if (failure === null) return;
    if (isStaleInviteError(failure)) {
        logger.warn(
            `Rejecting the invite to ${roomId} failed (${describe(failure)}); the server has no invite any more`,
        );
    } else {
        logger.warn(`Rejecting the invite to ${roomId} failed (${describe(failure)}); retrying in the background`);
        retryInBackground(client, roomId, failure);
    }
}

function retryInBackground(client: MatrixClient, roomId: string, firstFailure: unknown): void {
    if (retrying.has(roomId)) return;
    retrying.add(roomId);
    let attempt = 0;
    const schedule = (failure: unknown): void => {
        const delay = Math.max(
            safeGetRetryAfterMs(failure, 0),
            RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)],
        );
        attempt++;
        setTimeout(async () => {
            try {
                await client.leave(roomId);
            } catch (error) {
                if (!isStaleInviteError(error)) {
                    logger.warn(`Retry ${attempt} of rejecting the invite to ${roomId} failed (${describe(error)})`);
                    return schedule(error);
                }
            }
            retrying.delete(roomId);
            logger.info(
                `Rejected the invite to ${roomId} after ${attempt} background ${attempt === 1 ? "retry" : "retries"}`,
            );
        }, delay);
    };
    schedule(firstFailure);
}

/**
 * Marks the room as left right away and writes a "leave" for it into the cached sync data, the same
 * thing a /sync reporting the rejection would do. Done after a successful rejection too, since the
 * sync that should confirm it is exactly what fails to arrive when an invite gets stuck.
 */
export async function dropInviteLocally(client: MatrixClient, roomId: string): Promise<void> {
    const room = client.getRoom(roomId);
    if (room?.getMyMembership() === KnownMembership.Invite) {
        room.updateMyMembership(KnownMembership.Leave);
        // The same guard Haven's own leave path sets (see pendingRoomLeave.ts).
        markPendingLeave(roomId);
    }

    try {
        const syncToken = client.store.getSyncToken();
        if (!syncToken) return;
        await client.store.setSyncData({
            next_batch: syncToken,
            rooms: {
                join: {},
                invite: {},
                knock: {},
                leave: {
                    [roomId]: {
                        state: { events: [] },
                        timeline: { events: [], prev_batch: null },
                        account_data: { events: [] },
                    },
                },
            },
            account_data: { events: [] },
        });
        await client.store.save(true);
    } catch (error) {
        logger.warn(`Couldn't remove the invite to ${roomId} from the sync cache`, error);
    }
}

/*
 * Haven apps framework - the message a game app's game was shared in.
 */

import { KnownMembership, type MatrixClient, type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { MediaEventHelper } from "../../../../element-web/apps/web/src/utils/MediaEventHelper";
import { readWebxdcArchive, type WebxdcArchive } from "../../../../element-web/apps/web/src/utils/webxdc";
import { isFlashFile, isGameFile, readFlashArchive } from "../../../../element-web/apps/web/src/utils/flash";
import { type GameAppEntry } from "./gameApps";

export function isInRoom(client: MatrixClient, roomId: string): boolean {
    return client.getRoom(roomId)?.getMyMembership() === KnownMembership.Join;
}

/**
 * The game's message, from the room's loaded timeline or else the server, decrypted. Null when the
 * server doesn't have it for the user.
 */
export async function fetchGameEvent(
    client: MatrixClient,
    roomId: string,
    eventId: string,
): Promise<MatrixEvent | null> {
    let event = client.getRoom(roomId)?.findEventById(eventId) ?? null;
    if (!event) {
        try {
            event = client.getEventMapper()(await client.fetchRoomEvent(roomId, eventId));
        } catch (e) {
            logger.warn("Couldn't fetch a game app's message", e);
            return null;
        }
    }
    await client.decryptEventIfNeeded(event);
    return event;
}

/** Whether the message still holds a game: it's been neither deleted nor edited into something else. */
export function isGameEvent(event: MatrixEvent): boolean {
    return !event.isRedacted() && isGameFile(event.getContent());
}

/** Downloads and opens the game in the message. */
export async function readGameArchive(event: MatrixEvent, entry: GameAppEntry): Promise<WebxdcArchive | undefined> {
    const helper = new MediaEventHelper(event);
    try {
        const blob = await helper.sourceBlob.value;
        return isFlashFile(event.getContent())
            ? await readFlashArchive(blob, entry.name)
            : await readWebxdcArchive(blob);
    } catch (e) {
        logger.warn("Couldn't open a game app's game", e);
        return undefined;
    } finally {
        helper.destroy();
    }
}

/*
 * MSC4459 (Image pack references) — attaches provenance metadata to an event containing a pack
 * image, so a recipient can trace it back to the pack (room + state_key) it came from and, e.g.,
 * offer to add that pack themselves.
 *
 * Unstable prefix only (com.beeper.msc4459.image_source_packs) - unlike MSC2545, this MSC has not
 * been merged/stabilized, so there is no stable name to prefer yet.
 */

import { JoinRule, type Room } from "matrix-js-sdk/src/matrix";

import { calculateRoomVia } from "./permalinks/Permalinks";

export const IMAGE_SOURCE_PACKS_KEY = "com.beeper.msc4459.image_source_packs";

export interface ImageSourcePackRef {
    room_id: string;
    via?: string[];
    state_key: string;
    shortcode: string;
}

/** MSC4459: "To avoid leaking information about private packs, clients SHOULD only reference packs
 *  that are in a public or knockable room." */
function isReferenceableRoom(room: Room): boolean {
    const joinRule = room.getJoinRule();
    return joinRule === JoinRule.Public || joinRule === JoinRule.Knock;
}

/** Builds the `{ [mxcUrl]: ImageSourcePackRef }` map MSC4459 defines - an empty object when the
 *  source room isn't public/knockable, per the MSC's own privacy guidance, so callers can just
 *  merge it into their content unconditionally without their own extra check. */
export function buildImageSourcePacks(
    mxcUrl: string,
    room: Room,
    stateKey: string,
    shortcode: string,
): Record<string, ImageSourcePackRef> {
    if (!isReferenceableRoom(room)) return {};
    return {
        [mxcUrl]: {
            room_id: room.roomId,
            via: calculateRoomVia(room),
            state_key: stateKey,
            shortcode,
        },
    };
}

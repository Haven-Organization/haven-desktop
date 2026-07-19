/*
 * MSC4459 (Image pack references) — attaches provenance metadata to an event containing a pack
 * image, so a recipient can trace it back to the pack (room + state_key) it came from and, e.g.,
 * offer to add that pack themselves.
 *
 * Unstable prefix only (com.beeper.msc4459.image_source_packs) - unlike MSC2545, this MSC has not
 * been merged/stabilized, so there is no stable name to prefer yet.
 */

import { JoinRule, type Room, type MatrixClient, type MatrixEvent } from "matrix-js-sdk/src/matrix";

import { calculateRoomVia } from "./permalinks/Permalinks";
import { Type, type Part } from "../editor/parts";
import type EditorModel from "../editor/model";
import SettingsStore from "../settings/SettingsStore";

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
 *  source room isn't public/knockable, per the MSC's own privacy guidance, or when the user has
 *  turned off "Haven.sendImagePackReferences" (off by default - see the Emoji & Stickers user
 *  settings tab), so callers can just merge it into their content unconditionally without their
 *  own extra check. This is the single choke point every sending call site goes through
 *  (buildImageSourcePacksFromModel included), so the setting only needs to be checked here, not at
 *  each call site - the receiving side (getImageSourcePackRefs/FindPackDialog) is untouched by it. */
export function buildImageSourcePacks(
    mxcUrl: string,
    room: Room,
    stateKey: string,
    shortcode: string,
): Record<string, ImageSourcePackRef> {
    if (!SettingsStore.getValue("Haven.sendImagePackReferences")) return {};
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

/** Walks a composer model for every CustomEmojiPart (an inline custom emoji typed/picked into a
 *  text message - see editor/parts.ts's own CustomEmojiPart) and builds the combined MSC4459
 *  `image_source_packs` map for all of them at once, so a plain text message carries the same
 *  provenance a sticker send already does. A part's own roomId (the pack's actual source room,
 *  which may not be the room the message is being sent into - a favorited pack can live anywhere)
 *  is resolved fresh against the client rather than trusted blindly, since the part only carries
 *  the room's ID, not a live Room reference. */
export function buildImageSourcePacksFromModel(
    model: EditorModel,
    client: MatrixClient,
): Record<string, ImageSourcePackRef> {
    const result: Record<string, ImageSourcePackRef> = {};
    for (const part of model.parts as Part[]) {
        if (part.type !== Type.CustomEmoji) continue;
        const sourceRoom = client.getRoom(part.roomId);
        if (!sourceRoom) continue;
        const shortcode = part.text.replace(/^:|:$/g, "");
        Object.assign(result, buildImageSourcePacks(part.mxcUrl, sourceRoom, part.stateKey, shortcode));
    }
    return result;
}

/** The receiving side of MSC4459 - every pack reference an event carries (a sticker/text message
 *  has its own IMAGE_SOURCE_PACKS_KEY field on its top-level content, a custom emoji reaction has
 *  it on the reaction event's own content), regardless of which particular image within the event
 *  each ref is actually for. Used to offer "find this pack" wherever such a reference exists - see
 *  components/views/dialogs/FindPackDialog.tsx. */
export function getImageSourcePackRefs(mxEvent: MatrixEvent): ImageSourcePackRef[] {
    const content = mxEvent.getContent();
    const map = content[IMAGE_SOURCE_PACKS_KEY];
    if (!map || typeof map !== "object") return [];
    return Object.values(map as Record<string, ImageSourcePackRef>);
}

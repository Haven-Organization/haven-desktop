// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { MatrixEvent } from "matrix-js-sdk/src/matrix";

vi.mock("../../../../element-web/apps/web/src/customisations/Media", () => ({
    mediaFromMxc: (mxc: string) => ({ srcHttp: mxc.replace("mxc://", "https://media.example/") }),
}));
vi.mock("../../../../element-web/apps/web/src/settings/SettingsStore", () => ({ default: { getValue: () => true } }));
vi.mock("../../../../element-web/apps/web/src/MatrixClientPeg", () => ({ MatrixClientPeg: { get: () => null } }));

import { formattedRoomNameHtml } from "./formattedRoomName";

const NAME = "Blob Cats :blobcat:";
const FORMATTED = {
    format: "org.matrix.custom.html",
    formatted_body: '<b>Blob Cats</b> <img data-mx-emoticon src="mxc://example.org/abc" alt=":blobcat:">',
};

function nameEvent(content: Record<string, unknown>): MatrixEvent {
    return new MatrixEvent({ type: "m.room.name", state_key: "", content, room_id: "!r:example.org" });
}

const withFormatted = nameEvent({ "name": NAME, "org.matrix.msc4591.formatted_name": FORMATTED });

describe("formattedRoomNameHtml", () => {
    it("shows the formatted name in place of the room's own name", () => {
        expect(formattedRoomNameHtml(withFormatted, "join", NAME)).toContain("<b>Blob Cats</b>");
    });

    it("accepts the stable key too", () => {
        const ev = nameEvent({ "name": NAME, "m.formatted_name": FORMATTED });
        expect(formattedRoomNameHtml(ev, "join", NAME)).toContain("<b>Blob Cats</b>");
    });

    it("shows the plain name for a pending invite", () => {
        expect(formattedRoomNameHtml(withFormatted, "invite", NAME)).toBeUndefined();
    });

    it("only stands in for the room's m.room.name, not a name shown instead of it", () => {
        expect(formattedRoomNameHtml(withFormatted, "join", "My nickname for it")).toBeUndefined();
    });

    it("ignores it without a plain name, or when the text doesn't match", () => {
        const noName = nameEvent({ "org.matrix.msc4591.formatted_name": FORMATTED });
        expect(formattedRoomNameHtml(noName, "join", "")).toBeUndefined();
        const renamed = nameEvent({ "name": "Dog people", "org.matrix.msc4591.formatted_name": FORMATTED });
        expect(formattedRoomNameHtml(renamed, "join", "Dog people")).toBeUndefined();
    });

    it("does nothing for a room without one", () => {
        expect(formattedRoomNameHtml(nameEvent({ name: NAME }), "join", NAME)).toBeUndefined();
        expect(formattedRoomNameHtml(null, "join", NAME)).toBeUndefined();
    });
});

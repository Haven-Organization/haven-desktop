/*
 * Social Overlay - postEdit tests
 *
 * Coverage for editing a post from the pop-up post composer - see postEdit.ts.
 */

// @vitest-environment happy-dom
// test-utils transitively imports code that calls window.btoa at module load time, and reading a
// post back into composer text parses its HTML with DOMParser.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { type MatrixClient, MatrixEvent, Room } from "matrix-js-sdk/src/matrix";
import { createTestClient } from "test-utils";

import { buildEditedContent, canEditPost, editDraftFor, makeEditContent, sendPostEdit, splitMedia } from "./postEdit";
import { MSC4501_BODY_KEY, MSC4501_RELATES_TO_KEY, MSC4501_REL_TYPE_REPOST } from "./room-classifier";
import { interceptComposerSend, registerComposerSendInterceptor } from "../../framework/composerSendInterceptor";

const ME = "@me:example.org";
const BOB = "@bob:example.org";
const ROOM_ID = "!profile:example.org";

function post(content: Record<string, unknown>, extra: Record<string, unknown> = {}): MatrixEvent {
    return new MatrixEvent({
        type: "m.room.message",
        event_id: "$post",
        room_id: ROOM_ID,
        sender: ME,
        content,
        ...extra,
    });
}

const IMAGE = {
    msgtype: "m.image",
    url: "mxc://example.org/cat",
    info: { mimetype: "image/png", w: 10, h: 10, size: 99 },
};

describe("canEditPost", () => {
    let client: MatrixClient;
    beforeEach(() => {
        client = createTestClient();
        client.getUserId = () => ME;
    });

    it("allows the user's own text and media posts", () => {
        expect(canEditPost(client, post({ msgtype: "m.text", body: "hi" }))).toBe(true);
        expect(canEditPost(client, post({ ...IMAGE, body: "cat.png" }))).toBe(true);
        expect(canEditPost(client, post({ msgtype: "m.location", body: "Location", geo_uri: "geo:1,2" }))).toBe(true);
    });

    it("refuses someone else's post", () => {
        expect(canEditPost(client, post({ msgtype: "m.text", body: "hi" }, { sender: BOB }))).toBe(false);
    });

    it("refuses polls, stickers and notices", () => {
        expect(canEditPost(client, post({ body: "sticker" }, { type: "m.sticker" }))).toBe(false);
        expect(canEditPost(client, post({ body: "q" }, { type: "org.matrix.msc3381.poll.start" }))).toBe(false);
        expect(canEditPost(client, post({ msgtype: "m.notice", body: "bot" }))).toBe(false);
    });

    it("refuses a plain boost, whose body is only a link to the reposted post", () => {
        const boost = post({
            msgtype: "m.text",
            body: "https://matrix.to/#/!other:example.org/$orig",
            [MSC4501_RELATES_TO_KEY]: {
                rel_type: MSC4501_REL_TYPE_REPOST,
                event_id: "$orig",
                room_id: "!other:example.org",
            },
        });
        expect(canEditPost(client, boost)).toBe(false);
    });

    it("refuses an edit itself", () => {
        const edit = post({
            msgtype: "m.text",
            body: "* hi",
            "m.relates_to": { rel_type: "m.replace", event_id: "$x" },
        });
        expect(canEditPost(client, edit)).toBe(false);
    });
});

describe("editDraftFor", () => {
    let client: MatrixClient;
    let room: Room;
    beforeEach(() => {
        client = createTestClient();
        room = new Room(ROOM_ID, client, ME);
    });

    it("turns a mention pill back into the user ID the composer pills", () => {
        const draft = editDraftFor(
            client,
            room,
            post({
                msgtype: "m.text",
                body: "hi Bob",
                format: "org.matrix.custom.html",
                formatted_body: `hi <a href="https://matrix.to/#/${BOB}">Bob</a>`,
            }),
        );
        expect(draft).toEqual({ body: `hi ${BOB}`, media: null });
    });

    it("puts /me back in front of an emote", () => {
        expect(editDraftFor(client, room, post({ msgtype: "m.emote", body: "waves" })).body).toBe("/me waves");
    });

    it("stages a media post's media and keeps its caption as the text", () => {
        const draft = editDraftFor(client, room, post({ ...IMAGE, body: "my cat", filename: "cat.png" }));
        expect(draft.body).toBe("my cat");
        expect(draft.media).toEqual({
            kind: "image",
            content: { ...IMAGE, filename: "cat.png" },
            defaultBody: "cat.png",
            name: "cat.png",
        });
    });

    it("has no text for media without a caption", () => {
        const draft = editDraftFor(client, room, post({ ...IMAGE, body: "cat.png", filename: "cat.png" }));
        expect(draft.body).toBe("");
        expect(draft.media?.kind).toBe("image");
    });
});

describe("splitMedia", () => {
    it("treats stock's location body as no caption", () => {
        const { media, caption } = splitMedia({
            msgtype: "m.location",
            body: "Location geo:1,2 at 2026-10-23",
            geo_uri: "geo:1,2",
            "org.matrix.msc1767.text": "Location geo:1,2 at 2026-10-23",
        });
        expect(caption).toBeNull();
        expect(media.kind).toBe("location");
        expect(media.defaultBody).toBe("Location geo:1,2 at 2026-10-23");
        expect(media.content).toEqual({ msgtype: "m.location", geo_uri: "geo:1,2" });
    });

    it("recognizes a voice message", () => {
        const { media, caption } = splitMedia({
            msgtype: "m.audio",
            body: "Voice message",
            url: "mxc://example.org/voice",
            "org.matrix.msc3245.voice": {},
        });
        expect(caption).toBeNull();
        expect(media.kind).toBe("voice");
    });
});

describe("buildEditedContent", () => {
    let client: MatrixClient;
    const upload = vi.fn(async (file: File, caption: string) => ({
        msgtype: "m.image",
        body: caption || file.name,
        filename: file.name,
        url: "mxc://example.org/new",
    }));
    beforeEach(() => {
        client = createTestClient();
        client.getUserId = () => ME;
        upload.mockClear();
    });

    it("rebuilds text, and drops a bridge's body override that would hide the new text", async () => {
        const original = post({ msgtype: "m.text", body: "old", [MSC4501_BODY_KEY]: "old override" });
        const content = await buildEditedContent(client, ROOM_ID, original, { body: "new" }, upload);
        expect(content.body).toBe("new");
        expect(content.msgtype).toBe("m.text");
        expect(content).not.toHaveProperty(MSC4501_BODY_KEY);
    });

    it("keeps a quote post's repost relation", async () => {
        const relation = {
            rel_type: MSC4501_REL_TYPE_REPOST,
            event_id: "$orig",
            room_id: "!other:example.org",
            sender: BOB,
            content: { msgtype: "m.text", body: "original" },
        };
        const original = post({ msgtype: "m.text", body: "my take", [MSC4501_RELATES_TO_KEY]: relation });
        const content = await buildEditedContent(client, ROOM_ID, original, { body: "better take" }, upload);
        expect(content[MSC4501_RELATES_TO_KEY]).toEqual(relation);
    });

    it("turns a text post into a media post with a newly picked file", async () => {
        const file = new File(["x"], "dog.png", { type: "image/png" });
        const original = post({ msgtype: "m.text", body: "look" });
        const content = await buildEditedContent(client, ROOM_ID, original, { body: "look", file }, upload);
        expect(upload).toHaveBeenCalledWith(file, "look");
        expect(content).toMatchObject({ msgtype: "m.image", url: "mxc://example.org/new", body: "look" });
    });

    it("keeps already-uploaded media without uploading it again, with the new caption", async () => {
        const original = post({ ...IMAGE, body: "my cat", filename: "cat.png" });
        const { media } = splitMedia(original.getContent());
        const content = await buildEditedContent(client, ROOM_ID, original, { body: "", media }, upload);
        expect(upload).not.toHaveBeenCalled();
        expect(content).toEqual({ ...IMAGE, filename: "cat.png", body: "cat.png" });
    });
});

describe("makeEditContent", () => {
    it("wraps the new content in an m.replace edit", () => {
        const original = post({ msgtype: "m.text", body: "old" });
        const edit = makeEditContent(original, { msgtype: "m.text", body: "new" });
        expect(edit).toEqual({
            "msgtype": "m.text",
            "body": "* new",
            "m.mentions": {},
            "m.new_content": { msgtype: "m.text", body: "new" },
            "m.relates_to": { rel_type: "m.replace", event_id: "$post" },
        });
    });

    it("only notifies users the edit newly mentions", () => {
        const original = post({ "msgtype": "m.text", "body": "hi", "m.mentions": { user_ids: [BOB] } });
        const edit = makeEditContent(original, {
            "msgtype": "m.text",
            "body": "hi",
            "m.mentions": { user_ids: [BOB, "@carol:example.org"] },
        });
        expect(edit["m.mentions"]).toEqual({ user_ids: ["@carol:example.org"] });
    });
});

describe("sendPostEdit", () => {
    it("shows the edit on the post on screen as soon as it's sent", async () => {
        const client = createTestClient();
        client.getUserId = () => ME;
        client.getRoom = () => null;
        client.sendEvent = vi.fn().mockResolvedValue({ event_id: "$edit" }) as any;
        const original = post({ msgtype: "m.text", body: "old" });
        const replaced = vi.fn();
        original.on("Event.replaced" as any, replaced);

        await sendPostEdit(client, original, { msgtype: "m.text", body: "new" });

        expect(client.sendEvent).toHaveBeenCalledWith(ROOM_ID, null, "m.room.message", expect.anything());
        expect(original.replacingEventId()).toBe("$edit");
        expect(original.getContent().body).toBe("new");
        expect(replaced).toHaveBeenCalled();
    });
});

describe("composerSendInterceptor", () => {
    it("takes content for its own room until it's removed", () => {
        const taken = vi.fn();
        const remove = registerComposerSendInterceptor(ROOM_ID, taken);
        expect(interceptComposerSend("!elsewhere:example.org", { body: "x" })).toBe(false);
        expect(interceptComposerSend(ROOM_ID, { body: "x" })).toBe(true);
        expect(taken).toHaveBeenCalledWith(ROOM_ID, { body: "x" });
        remove();
        expect(interceptComposerSend(ROOM_ID, { body: "x" })).toBe(false);
    });
});

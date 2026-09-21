/*
 * Social Overlay - nestedRepost tests
 *
 * Guards the rules behind "a repost of a repost renders as a nested card": without them the middle
 * reposter's card shows the original author's text/media under the middle reposter's own name, as
 * though they'd said it.
 */

import { describe, it, expect } from "vitest";

import {
    resolveNestedRepost,
    showsMiddleRepostBody,
    showsMiddleRepostMedia,
    withoutWrapperOnlyFields,
} from "./nestedRepost";
import {
    MSC4501_BODY_KEY,
    MSC4501_RELATES_TO_KEY,
    MSC4501_REL_TYPE_REPLY,
    MSC4501_REL_TYPE_REPOST,
} from "./room-classifier";

const ORIGINAL = { msgtype: "m.text", body: "the original post" };

/** A snapshot of a middle reposter's post: it reposts `ORIGINAL`, per the given relation fields. */
function middleSnapshot(relation: Record<string, unknown>, own: Record<string, unknown> = {}): Record<string, any> {
    return {
        msgtype: "m.text",
        body: "permalink filler",
        ...own,
        [MSC4501_RELATES_TO_KEY]: {
            rel_type: MSC4501_REL_TYPE_REPOST,
            event_id: "$original",
            room_id: "!orig:example.org",
            sender: "@author:example.org",
            ...relation,
        },
    };
}

describe("withoutWrapperOnlyFields", () => {
    it("drops the wrapper's own relation but keeps everything else", () => {
        const content = { body: "hi", [MSC4501_RELATES_TO_KEY]: { rel_type: MSC4501_REL_TYPE_REPOST } };
        expect(withoutWrapperOnlyFields(content)).toEqual({ body: "hi" });
    });

    it("returns the same object when there's nothing to strip, and passes undefined through", () => {
        const content = { body: "hi" };
        expect(withoutWrapperOnlyFields(content)).toBe(content);
        expect(withoutWrapperOnlyFields(undefined)).toBeUndefined();
    });
});

describe("resolveNestedRepost", () => {
    it("is undefined for an ordinary post being reposted", () => {
        expect(resolveNestedRepost({ msgtype: "m.text", body: "plain" })).toBeUndefined();
        expect(resolveNestedRepost(undefined)).toBeUndefined();
    });

    it("is undefined when the snapshot's relation isn't a repost (e.g. a reply)", () => {
        const reply = {
            body: "a reply",
            [MSC4501_RELATES_TO_KEY]: { rel_type: MSC4501_REL_TYPE_REPLY, content: ORIGINAL },
        };
        expect(resolveNestedRepost(reply)).toBeUndefined();
    });

    it("finds the original post in the nested relation's own snapshot", () => {
        const nested = resolveNestedRepost(middleSnapshot({ content: ORIGINAL }));

        expect(nested?.sourceContent).toBe(ORIGINAL);
        expect(nested?.relation.sender).toBe("@author:example.org");
        expect(nested?.relation.event_id).toBe("$original");
        expect(nested?.middleHasOwnContent).toBe(true);
    });

    it("for a content_inline nested relation, the whole snapshot is the original's content", () => {
        const nested = resolveNestedRepost(middleSnapshot({ content_inline: true }));

        expect(nested?.sourceContent).toEqual({ msgtype: "m.text", body: "permalink filler" });
        // ...and the wrapper's own relation isn't left in to make it look like yet another repost
        expect(nested?.sourceContent).not.toHaveProperty(MSC4501_RELATES_TO_KEY);
        expect(nested?.middleHasOwnContent).toBe(false);
    });

    it("falls back to the plain single-card rendering when there's no snapshot of the nested post", () => {
        expect(resolveNestedRepost(middleSnapshot({}))).toBeUndefined();
    });

    it("hands back the nested post's own snapshot untouched: nothing is resolved a level deeper", () => {
        const deeper = {
            ...ORIGINAL,
            [MSC4501_RELATES_TO_KEY]: { rel_type: MSC4501_REL_TYPE_REPOST, content: { body: "deeper" } },
        };
        const nested = resolveNestedRepost(middleSnapshot({ content: deeper }));

        expect(nested?.sourceContent).toBe(deeper);
        // resolving the outer snapshot never inspects the level below the nested post
        expect(nested?.relation.content).toBe(deeper);
        expect(nested?.relation.rel_type).toBe(MSC4501_REL_TYPE_REPOST);
    });
});

describe("what the middle reposter's own card shows", () => {
    it("shows body and media exactly as before for a plain (non-nested) repost", () => {
        expect(showsMiddleRepostBody(undefined, { body: "x" })).toBe(true);
        expect(showsMiddleRepostMedia(undefined)).toBe(true);
    });

    it("hides the snapshot's body and media when it's really the original's (content_inline)", () => {
        const nested = resolveNestedRepost(middleSnapshot({ content_inline: true }));

        expect(showsMiddleRepostBody(nested, middleSnapshot({ content_inline: true }))).toBe(false);
        expect(showsMiddleRepostMedia(nested)).toBe(false);
    });

    it("keeps the middle reposter's own caption when they wrote one (MSC4501 body override)", () => {
        const snapshot = middleSnapshot({ content: ORIGINAL }, { [MSC4501_BODY_KEY]: "look at this" });
        const nested = resolveNestedRepost(snapshot);

        expect(showsMiddleRepostBody(nested, snapshot)).toBe(true);
        expect(showsMiddleRepostMedia(nested)).toBe(true);
    });

    it("doesn't mistake the stock permalink filler for a caption", () => {
        const snapshot = middleSnapshot({ content: ORIGINAL });
        const nested = resolveNestedRepost(snapshot);

        expect(showsMiddleRepostBody(nested, snapshot)).toBe(false);
    });
});

/*
 * Social Overlay - repostContentMatches tests
 *
 * Regression coverage for a genuine bridge repost of a bridged cross-posted reply being flagged
 * as a possible forgery: the original post carries its "⤵️ Reply to X's post:" line in its stock
 * body/formatted_body, while the repost embeds the content through MSC4501's social.body/
 * social.formatted_body with that line left out. Fixture content is taken verbatim from the two
 * real events involved.
 */

// @vitest-environment happy-dom

import { describe, it, expect } from "vitest";

import { repostContentMatches } from "./SocialEventTile";

const MENTIONS_TEXT = "@radians @thomasroiloup @ChristiJunior @deprecated_ii @rlier23";
const MENTIONS_HTML =
    '<span><span><a href="https://matrix.to/#/@fedi_radians_poa.st:glowers.club">@<span>radians</span></a></span> ' +
    '<span><a href="https://matrix.to/#/@fedi_thomasroiloup_shitposter.world:glowers.club">@<span>thomasroiloup</span></a></span> ' +
    '<span><a href="https://matrix.to/#/@fedi_christijunior_detroitriotcity.com:glowers.club">@<span>ChristiJunior</span></a></span> ' +
    '<span><a href="https://matrix.to/#/@fedi_deprecated_ii_poa.st:glowers.club">@<span>deprecated_ii</span></a></span> ' +
    '<span><a href="https://matrix.to/#/@fedi_rlier23_detroitriotcity.com:glowers.club">@<span>rlier23</span></a></span> </span>';
const PREAMBLE_HTML =
    '<p>⤵️ Reply to <a href="https://matrix.to/#/@fedi_radians_poa.st:glowers.club">radians</a>\'s ' +
    '<a href="https://poa.st/objects/56dca09b-504c-48e1-8e37-041b069439b1">post</a>:</p>';
const MEDIA = {
    msgtype: "m.video",
    url: "mxc://glowers.club/LmfujpdWDTtyTcjOQWWGOOct",
    info: { h: 852, mimetype: "video/mp4", w: 480 },
};

/** The repost's own content - embedded inline (content_inline), body is the boost's permalink. */
function repostSnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        ...MEDIA,
        body: "https://matrix.to/#/!JGwveliSeUFFhwsSvb:glowers.club/$GvFwQsjXkxxWdjL4hlKEKXRFsiTGBEFaU1cdLBaa6EI?via=glowers.club",
        format: "org.matrix.custom.html",
        formatted_body: "<p>🔁 reposted ...</p><blockquote>...</blockquote>",
        "org.matrix.msc4501.social.body": MENTIONS_TEXT,
        "org.matrix.msc4501.social.formatted_body": MENTIONS_HTML,
        ...overrides,
    };
}

/** The original post's content - header in its stock fields, no override, no remove_header. */
function originalPost(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        ...MEDIA,
        body: `⤵️ Reply to @radians@poa.st's post:\n\n${MENTIONS_TEXT}`,
        format: "org.matrix.custom.html",
        formatted_body: PREAMBLE_HTML + MENTIONS_HTML,
        ...overrides,
    };
}

describe("repostContentMatches", () => {
    it("accepts a genuine repost that leaves out the original's own reply preamble", () => {
        expect(repostContentMatches(repostSnapshot(), originalPost(), true)).toBe(true);
    });

    it("still flags a repost whose real content differs after the preamble", () => {
        const tampered = repostSnapshot({ "org.matrix.msc4501.social.body": "@radians something else" });
        expect(repostContentMatches(tampered, originalPost(), true)).toBe(false);
    });

    it("still flags a repost whose HTML differs after the preamble", () => {
        const tampered = repostSnapshot({
            "org.matrix.msc4501.social.formatted_body": MENTIONS_HTML.replace("radians_poa.st", "someone_else"),
        });
        expect(repostContentMatches(tampered, originalPost(), true)).toBe(false);
    });

    it("does not let a repost drop an ordinary (non-preamble) opening line", () => {
        const original = originalPost({
            body: `I do not agree with:\n\n${MENTIONS_TEXT}`,
            formatted_body: `<p>I do not agree with:</p>${MENTIONS_HTML}`,
        });
        expect(repostContentMatches(repostSnapshot(), original, true)).toBe(false);
    });

    it("does not strip the preamble when only the plain body has one", () => {
        const original = originalPost({ formatted_body: `<p>Not a preamble:</p>${MENTIONS_HTML}` });
        expect(repostContentMatches(repostSnapshot(), original, true)).toBe(false);
    });
});

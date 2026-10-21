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
    // A bridge's repost of a native plain-text post with several paragraphs. Content is taken from
    // the two real events involved.
    describe("a bridge's repost of a native post with several paragraphs", () => {
        const PARAGRAPHS = [
            "https://bsky.app/profile/example.org",
            "I have successfully bridged Matrix to both ActivityPub and AT Protocol.",
            "ActivityPub bridge: https://github.com/Haven-Organization/matrix-appservice-activitypub",
        ];
        const original = { body: PARAGRAPHS.join("\n\n"), format: "plain", msgtype: "m.text" };
        const snapshot = (paragraphs: string[] = PARAGRAPHS): Record<string, unknown> => ({
            "msgtype": "m.text",
            "body": "https://matrix.to/#/!room:example.org/$original?via=example.org",
            "format": "org.matrix.custom.html",
            "formatted_body": "<p>🔁 reposted ...</p><blockquote>...</blockquote>",
            "org.matrix.msc4501.social.body": paragraphs.join("\n"),
            "org.matrix.msc4501.social.formatted_body": paragraphs
                .map((p) => `<p>${p.replace(/https:\S+/g, (url) => `<a href="${url}">${url}</a>`)}</p>`)
                .join(""),
        });

        it("accepts it although the paragraphs are separated differently on each side", () => {
            expect(repostContentMatches(snapshot(), original, true)).toBe(true);
        });

        it("still flags it when the text differs", () => {
            const changed = [PARAGRAPHS[0], "I have NOT bridged anything.", PARAGRAPHS[2]];
            expect(repostContentMatches(snapshot(changed), original, true)).toBe(false);
        });

        it("still flags it when a paragraph is left out", () => {
            expect(repostContentMatches(snapshot(PARAGRAPHS.slice(0, 2)), original, true)).toBe(false);
        });
    });
});

describe("a bridge snapshot whose social.formatted_body is just its plain body", () => {
    // Taken from a real bridge-relayed repost and the shitposter.world post it reposted: the
    // snapshot's social.formatted_body has no tags and lost the original's paragraph break.
    const TEXT = "About time we threw out this outdated shitNow to see if the Federal government will freak out";
    const IMAGE = {
        msgtype: "m.image",
        url: "mxc://glowers.club/hAgumnXRgTMQsbZPcSjwFVJp",
        filename: "cc7419a4c31387bb2b4191142b1f433368b440811f7320f9e9ad4fa2aecab0ab.webp?name=2Zxf7bx6H2mTCQ.webp",
    };
    const original = {
        ...IMAGE,
        body: TEXT,
        format: "org.matrix.custom.html",
        formatted_body:
            "About time we threw out this outdated shit<br><br>Now to see if the Federal government will freak out",
        info: { h: 474, mimetype: "image/webp", w: 680 },
    };
    function snapshot(socialBody: string, socialFormattedBody: string): Record<string, unknown> {
        return {
            ...IMAGE,
            body: "https://matrix.to/#/!xVx-FcCcKrDAO7WPax6sAVXqsvMz6opWBrhHTaO-us8/$dYVpYHJmtfqbhPy6cPNd8O883RfBPm5WW_31TtpaoB4?via=glowers.club",
            format: "org.matrix.custom.html",
            formatted_body: "<p>🔁 q reposted cool_boy_mew's post</p><blockquote>" + TEXT + "</blockquote>",
            info: { h: 67, mimetype: "image/webp", w: 96 },
            "org.matrix.msc4501.social.body": socialBody,
            "org.matrix.msc4501.social.formatted_body": socialFormattedBody,
        };
    }

    it("accepts the genuine repost", () => {
        expect(repostContentMatches(snapshot(TEXT, TEXT), original, true)).toBe(true);
    });

    it("still flags a snapshot whose text differs", () => {
        const forged = TEXT.replace("Federal", "Provincial");
        expect(repostContentMatches(snapshot(forged, forged), original, true)).toBe(false);
    });

    it("still flags a tagless formatted_body that says something other than its own body", () => {
        expect(repostContentMatches(snapshot(TEXT, "Something else entirely"), original, true)).toBe(false);
    });
});

describe("a bridge's repost of a native post that mentions someone", () => {
    // Taken from a real bridge-relayed repost: the original native post had the mention as a pill
    // (display name as the link text, Matrix ID in body), the bridge's snapshot has the user's
    // fediverse handle in both.
    const USER = "@fedi_alice_social.example:example.org";
    const PILL = `https://matrix.to/#/${USER}`;
    const IMAGE = { msgtype: "m.image", info: { h: 280, mimetype: "image/gif", w: 498 } };
    const snapshot = (socialBody: string, socialFormattedBody: string): Record<string, unknown> => ({
        ...IMAGE,
        url: "mxc://example.org/EWImqpvwMVCcugtvdtNiXhrn",
        body: "https://matrix.to/#/!1-jTHKU94hqkwKuWMkVFuPEF5YNpTsU4A2C1Mb1vBCw/$QjaL2129IJyqdvOluKKHNX3IlF8Hj5kBuVRrGJc6BNA?via=example.org",
        format: "org.matrix.custom.html",
        formatted_body: "<p>🔁 reposted ...</p><blockquote>...</blockquote>",
        "org.matrix.msc4501.social.body": socialBody,
        "org.matrix.msc4501.social.formatted_body": socialFormattedBody,
    });
    const GENUINE = snapshot(
        "@alice@social.example  the dogs",
        `<p><a href="${PILL}">@alice@social.example</a>  the dogs</p>`,
    );
    const pillOriginal = {
        ...IMAGE,
        url: "mxc://example.org/OBnivaEIfgVIreHeTMbacdSw",
        body: `${USER}  the dogs`,
        format: "org.matrix.custom.html",
        formatted_body: `<a href="${PILL}">alice</a>  the dogs`,
    };

    it("accepts it although the mention is written differently on each side", () => {
        expect(repostContentMatches(GENUINE, pillOriginal, true)).toBe(true);
    });

    it("accepts it when the original's mention was plain text", () => {
        const plainOriginal = { ...pillOriginal, format: undefined, formatted_body: undefined };
        expect(repostContentMatches(GENUINE, plainOriginal, true)).toBe(true);
    });

    it("still flags a mention that links to someone else", () => {
        const other = "https://matrix.to/#/@someone_else:example.org";
        const forged = snapshot(
            "@alice@social.example  the dogs",
            `<p><a href="${other}">@alice@social.example</a>  the dogs</p>`,
        );
        expect(repostContentMatches(forged, pillOriginal, true)).toBe(false);
    });

    it("still flags changed text around the mention", () => {
        const forged = snapshot(
            "@alice@social.example  the cats",
            `<p><a href="${PILL}">@alice@social.example</a>  the cats</p>`,
        );
        expect(repostContentMatches(forged, pillOriginal, true)).toBe(false);
    });
});

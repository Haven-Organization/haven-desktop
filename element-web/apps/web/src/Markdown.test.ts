/*
Copyright 2024 New Vector Ltd.
Copyright 2021 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect } from "vitest";

import Markdown from "./Markdown";

describe("Markdown parser test", () => {
    describe("fixing HTML links", () => {
        const testString = [
            "Test1:",
            "#_foonetic_xkcd:matrix.org",
            "http://google.com/_thing_",
            "https://matrix.org/_matrix/client/foo/123_",
            "#_foonetic_xkcd:matrix.org",
            "",
            "Test1A:",
            "#_foonetic_xkcd:matrix.org",
            "http://google.com/_thing_",
            "https://matrix.org/_matrix/client/foo/123_",
            "#_foonetic_xkcd:matrix.org",
            "",
            "Test2:",
            "http://domain.xyz/foo/bar-_stuff-like-this_-in-it.jpg",
            "http://domain.xyz/foo/bar-_stuff-like-this_-in-it.jpg",
            "",
            "Test3:",
            "https://riot.im/app/#/room/#_foonetic_xkcd:matrix.org",
            "https://riot.im/app/#/room/#_foonetic_xkcd:matrix.org",
        ].join("\n");

        it("tests that links with markdown empasis in them are getting properly HTML formatted", () => {
            const expectedResult = [
                "<p>Test1:<br />#_foonetic_xkcd:matrix.org<br />http://google.com/_thing_<br />https://matrix.org/_matrix/client/foo/123_<br />#_foonetic_xkcd:matrix.org</p>",
                "<p>Test1A:<br />#_foonetic_xkcd:matrix.org<br />http://google.com/_thing_<br />https://matrix.org/_matrix/client/foo/123_<br />#_foonetic_xkcd:matrix.org</p>",
                "<p>Test2:<br />http://domain.xyz/foo/bar-_stuff-like-this_-in-it.jpg<br />http://domain.xyz/foo/bar-_stuff-like-this_-in-it.jpg</p>",
                "<p>Test3:<br />https://riot.im/app/#/room/#_foonetic_xkcd:matrix.org<br />https://riot.im/app/#/room/#_foonetic_xkcd:matrix.org</p>",
                "",
            ].join("\n");
            const md = new Markdown(testString);
            expect(md.toHTML()).toEqual(expectedResult);
        });
        it("tests that links with autolinks are not touched at all and are still properly formatted", () => {
            const test = [
                "Test1:",
                "<#_foonetic_xkcd:matrix.org>",
                "<http://google.com/_thing_>",
                "<https://matrix.org/_matrix/client/foo/123_>",
                "<#_foonetic_xkcd:matrix.org>",
                "",
                "Test1A:",
                "<#_foonetic_xkcd:matrix.org>",
                "<http://google.com/_thing_>",
                "<https://matrix.org/_matrix/client/foo/123_>",
                "<#_foonetic_xkcd:matrix.org>",
                "",
                "Test2:",
                "<http://domain.xyz/foo/bar-_stuff-like-this_-in-it.jpg>",
                "<http://domain.xyz/foo/bar-_stuff-like-this_-in-it.jpg>",
                "",
                "Test3:",
                "<https://riot.im/app/#/room/#_foonetic_xkcd:matrix.org>",
                "<https://riot.im/app/#/room/#_foonetic_xkcd:matrix.org>",
            ].join("\n");
            /**
             * NOTE: I'm not entirely sure if those "<"" and ">" should be visible in here for #_foonetic_xkcd:matrix.org
             * but it seems to be actually working properly
             */
            const expectedResult = [
                '<p>Test1:<br />&lt;#_foonetic_xkcd:matrix.org&gt;<br /><a href="http://google.com/_thing_">http://google.com/_thing_</a><br /><a href="https://matrix.org/_matrix/client/foo/123_">https://matrix.org/_matrix/client/foo/123_</a><br />&lt;#_foonetic_xkcd:matrix.org&gt;</p>',
                '<p>Test1A:<br />&lt;#_foonetic_xkcd:matrix.org&gt;<br /><a href="http://google.com/_thing_">http://google.com/_thing_</a><br /><a href="https://matrix.org/_matrix/client/foo/123_">https://matrix.org/_matrix/client/foo/123_</a><br />&lt;#_foonetic_xkcd:matrix.org&gt;</p>',
                '<p>Test2:<br /><a href="http://domain.xyz/foo/bar-_stuff-like-this_-in-it.jpg">http://domain.xyz/foo/bar-_stuff-like-this_-in-it.jpg</a><br /><a href="http://domain.xyz/foo/bar-_stuff-like-this_-in-it.jpg">http://domain.xyz/foo/bar-_stuff-like-this_-in-it.jpg</a></p>',
                '<p>Test3:<br /><a href="https://riot.im/app/#/room/#_foonetic_xkcd:matrix.org">https://riot.im/app/#/room/#_foonetic_xkcd:matrix.org</a><br /><a href="https://riot.im/app/#/room/#_foonetic_xkcd:matrix.org">https://riot.im/app/#/room/#_foonetic_xkcd:matrix.org</a></p>',
                "",
            ].join("\n");
            const md = new Markdown(test);
            expect(md.toHTML()).toEqual(expectedResult);
        });

        it("expects that links in codeblock are not modified", () => {
            const expectedResult = [
                '<pre><code class="language-Test1:">#_foonetic_xkcd:matrix.org',
                "http://google.com/_thing_",
                "https://matrix.org/_matrix/client/foo/123_",
                "#_foonetic_xkcd:matrix.org",
                "",
                "Test1A:",
                "#_foonetic_xkcd:matrix.org",
                "http://google.com/_thing_",
                "https://matrix.org/_matrix/client/foo/123_",
                "#_foonetic_xkcd:matrix.org",
                "",
                "Test2:",
                "http://domain.xyz/foo/bar-_stuff-like-this_-in-it.jpg",
                "http://domain.xyz/foo/bar-_stuff-like-this_-in-it.jpg",
                "",
                "Test3:",
                "https://riot.im/app/#/room/#_foonetic_xkcd:matrix.org",
                "https://riot.im/app/#/room/#_foonetic_xkcd:matrix.org```",
                "</code></pre>",
                "",
            ].join("\n");
            const md = new Markdown("```" + testString + "```");
            expect(md.toHTML()).toEqual(expectedResult);
        });

        it('expects that links with emphasis are "escaped" correctly', () => {
            const testString = [
                "http://domain.xyz/foo/bar-_stuff-like-this_-in-it.jpg" +
                    " " +
                    "http://domain.xyz/foo/bar-_stuff-like-this_-in-it.jpg",
                "http://domain.xyz/foo/bar-_stuff-like-this_-in-it.jpg" +
                    " " +
                    "http://domain.xyz/foo/bar-_stuff-like-this_-in-it.jpg",
                "https://example.com/_test_test2_-test3",
                "https://example.com/_test_test2_test3_",
                "https://example.com/_test__test2_test3_",
                "https://example.com/_test__test2__test3_",
                "https://example.com/_test__test2_test3__",
                "https://example.com/_test__test2",
            ].join("\n");
            const expectedResult = [
                "http://domain.xyz/foo/bar-_stuff-like-this_-in-it.jpg http://domain.xyz/foo/bar-_stuff-like-this_-in-it.jpg",
                "http://domain.xyz/foo/bar-_stuff-like-this_-in-it.jpg http://domain.xyz/foo/bar-_stuff-like-this_-in-it.jpg",
                "https://example.com/_test_test2_-test3",
                "https://example.com/_test_test2_test3_",
                "https://example.com/_test__test2_test3_",
                "https://example.com/_test__test2__test3_",
                "https://example.com/_test__test2_test3__",
                "https://example.com/_test__test2",
            ].join("<br />");
            const md = new Markdown(testString);
            expect(md.toHTML()).toEqual(expectedResult);
        });

        it("expects that the link part will not be accidentally added to <strong>", () => {
            const testString = `https://github.com/matrix-org/synapse/blob/develop/synapse/module_api/__init__.py`;
            const expectedResult = "https://github.com/matrix-org/synapse/blob/develop/synapse/module_api/__init__.py";
            const md = new Markdown(testString);
            expect(md.toHTML()).toEqual(expectedResult);
        });

        it("expects that the link part will not be accidentally added to <strong> for multiline links", () => {
            const testString = [
                "https://github.com/matrix-org/synapse/blob/develop/synapse/module_api/__init__.py" +
                    " " +
                    "https://github.com/matrix-org/synapse/blob/develop/synapse/module_api/__init__.py",
                "https://github.com/matrix-org/synapse/blob/develop/synapse/module_api/__init__.py" +
                    " " +
                    "https://github.com/matrix-org/synapse/blob/develop/synapse/module_api/__init__.py",
            ].join("\n");
            const expectedResult = [
                "https://github.com/matrix-org/synapse/blob/develop/synapse/module_api/__init__.py" +
                    " " +
                    "https://github.com/matrix-org/synapse/blob/develop/synapse/module_api/__init__.py",
                "https://github.com/matrix-org/synapse/blob/develop/synapse/module_api/__init__.py" +
                    " " +
                    "https://github.com/matrix-org/synapse/blob/develop/synapse/module_api/__init__.py",
            ].join("<br />");
            const md = new Markdown(testString);
            expect(md.toHTML()).toEqual(expectedResult);
        });

        it("resumes applying formatting to the rest of a message after a link", () => {
            const testString = "http://google.com/_thing_ *does* __not__ exist";
            const expectedResult = "http://google.com/_thing_ <em>does</em> <strong>not</strong> exist";
            const md = new Markdown(testString);
            expect(md.toHTML()).toEqual(expectedResult);
        });
    });

    // Haven: regression test for a real bug (haven-desktop#6) - a custom emoji (MSC2545, serialized
    // as a raw <img data-mx-emoticon> tag by editor/serialize.ts's mdSerialize) sent as literally
    // the ENTIRE message came out as garbled, HTML-escaped text instead of a rendered image.
    // Commonmark reclassifies a tag that's the whole line as a block-level node rather than inline,
    // and folds any trailing whitespace on that line into the node's own literal - breaking the
    // isAllowedHtmlTag() whitelist regex's exact ^...$ match, so the tag fell through to the
    // "unrecognized HTML" escape() branch. Confirmed live to only reproduce when the emoji has
    // nothing else around it but whitespace - hence the emoji-plus-other-text case here too, as a
    // guard that the (already working) inline path stays working.
    describe("custom emoji (MSC2545)", () => {
        const emoji = '<img data-mx-emoticon height="32" src="mxc://example.org/abc" alt=":test:" title=":test:" />';

        it("renders a custom emoji sent as the entire message, with trailing whitespace", () => {
            // The trailing space survives in the output - commonmark folds it into the block-level
            // node's own literal (see this describe block's own doc), and it's emitted verbatim
            // once recognized. Harmless: it's outside the tag itself, and HTML collapses it anyway.
            const md = new Markdown(`${emoji} `);
            expect(md.toHTML()).toEqual(`${emoji} `);
        });

        it("renders a custom emoji sent as the entire message, with no trailing whitespace", () => {
            const md = new Markdown(emoji);
            expect(md.toHTML()).toEqual(emoji);
        });

        it("renders a custom emoji alongside other text", () => {
            const md = new Markdown(`hello ${emoji} world`);
            expect(md.toHTML()).toEqual(`hello ${emoji} world`);
        });
    });
});

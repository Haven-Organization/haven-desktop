// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../element-web/apps/web/src/customisations/Media", () => ({ mediaFromMxc: vi.fn() }));
vi.mock("../../../../element-web/apps/web/src/settings/SettingsStore", () => ({ default: { getValue: vi.fn() } }));
vi.mock("../../../../element-web/apps/web/src/MatrixClientPeg", () => ({ MatrixClientPeg: { get: vi.fn() } }));

import { formattedDisplayNameHtml, getRawFormattedDisplayName } from "./formattedDisplayName";

const toHttp = (mxc: string): string => mxc.replace("mxc://", "https://media.example/");
const html = (formatted_body: string): unknown => ({ format: "org.matrix.custom.html", formatted_body });
const EMOJI = '<img data-mx-emoticon src="mxc://example.org/abc" alt=":blobcat:" title=":blobcat:">';

describe("formattedDisplayNameHtml", () => {
    it("renders bold, italics and custom emoji matching the plain name", () => {
        const out = formattedDisplayNameHtml(html(`<b>Cat</b> ${EMOJI} <i>Person</i>`), "Cat :blobcat: Person", toHttp);
        expect(out).toContain("<b>Cat</b>");
        expect(out).toContain("<i>Person</i>");
        expect(out).toContain('src="https://media.example/example.org/abc"');
        expect(out).toContain('class="haven_FormattedDisplayName_emoji"');
    });

    it("ignores a formatted name whose text isn't the plain name", () => {
        expect(formattedDisplayNameHtml(html("<b>Admin</b>"), "Alice", toHttp)).toBeUndefined();
        expect(formattedDisplayNameHtml(html(EMOJI), "Cat", toHttp)).toBeUndefined();
    });

    it("strips tags and attributes that aren't permitted", () => {
        const out = formattedDisplayNameHtml(
            html('<a href="https://evil.example"><b onclick="x()">Al</b></a><span data-mx-color="#f00">ice</span>'),
            "Alice",
            toHttp,
        );
        expect(out).toBe("<b>Al</b>ice");
    });

    it("drops script content into the text check rather than running it", () => {
        expect(formattedDisplayNameHtml(html("<script>alert(1)</script>Bob"), "Bob", toHttp)).toBeUndefined();
        expect(formattedDisplayNameHtml(html("<img src=x onerror=alert(1) alt=Bob>"), "Bob", toHttp)).toBe("Bob");
    });

    it("shows images that aren't mxc custom emoji as their alt text", () => {
        expect(
            formattedDisplayNameHtml(
                html('<img data-mx-emoticon src="https://x.example/a.png" alt=":a:">'),
                ":a:",
                toHttp,
            ),
        ).toBe(":a:");
    });

    it("enforces the size, image and depth limits", () => {
        expect(formattedDisplayNameHtml(html("a".repeat(1025)), "a".repeat(1025), toHttp)).toBeUndefined();
        expect(formattedDisplayNameHtml(html(EMOJI.repeat(11)), ":blobcat:".repeat(11), toHttp)).toBeUndefined();
        expect(formattedDisplayNameHtml(html(EMOJI.repeat(10)), ":blobcat:".repeat(10), toHttp)).toBeDefined();
        const deep = "<b>".repeat(11) + "x" + "</b>".repeat(11);
        expect(formattedDisplayNameHtml(html(deep), "x", toHttp)).toBeUndefined();
    });

    it("ignores other formats and malformed values", () => {
        expect(
            formattedDisplayNameHtml({ format: "text/markdown", formatted_body: "**A**" }, "A", toHttp),
        ).toBeUndefined();
        expect(formattedDisplayNameHtml("<b>A</b>", "A", toHttp)).toBeUndefined();
        expect(formattedDisplayNameHtml(html("<b>A</b>"), undefined, toHttp)).toBeUndefined();
    });

    it("escapes text that looks like HTML", () => {
        expect(formattedDisplayNameHtml(html("&lt;b&gt;x"), "<b>x", toHttp)).toBe("&lt;b&gt;x");
    });
});

describe("formattedDisplayNameHtml against injection", () => {
    const tree = (node: Node): unknown =>
        node instanceof Element
            ? [
                  node.tagName,
                  Array.from(node.attributes).map((a) => [a.name, a.value]),
                  Array.from(node.childNodes).map(tree),
              ]
            : node.textContent;
    /** Renders the output and checks that nothing in it can run script or load anything else. */
    const expectInert = (out: string | undefined): void => {
        if (out === undefined) return;
        const div = document.createElement("div");
        div.innerHTML = out;
        for (const el of Array.from(div.querySelectorAll("*"))) {
            expect(["b", "strong", "i", "em", "u", "s", "del", "img"]).toContain(el.tagName.toLowerCase());
            for (const attr of Array.from(el.attributes)) {
                expect(["src", "alt", "title", "class", "data-mx-emoticon", "loading"]).toContain(attr.name);
                if (attr.name === "src") expect(attr.value).toMatch(/^https:\/\/media\.example\//);
            }
        }
        // And parsing it again gives the same tree, so a second parse can't turn into something else (mXSS).
        const again = document.createElement("div");
        again.innerHTML = div.innerHTML;
        expect(tree(again)).toEqual(tree(div));
    };
    const ATTACKS: Array<[string, string]> = [
        ["<script>alert(1)</script>", "alert(1)"],
        ['<img src=x onerror="alert(1)" alt="x">', "x"],
        ['<b onmouseover="alert(1)" style="x:expression(alert(1))">x</b>', "x"],
        ['<svg onload="alert(1)"><b>x</b></svg>', "x"],
        ["<svg><script>alert(1)</script></svg>", "alert(1)"],
        ['<math><mtext><table><mglyph><style><img src=x onerror="alert(1)">', '<img src=x onerror="alert(1)">'],
        ['<noscript><p title="</noscript><img src=x onerror=alert(1)>">', '<img src=x onerror=alert(1)>">'],
        ["<style>@import 'https://evil.example/x.css';</style>x", "@import 'https://evil.example/x.css';x"],
        ['<iframe src="javascript:alert(1)">x</iframe>', "x"],
        ['<a href="javascript:alert(1)">x</a>', "x"],
        ["<template><img src=x onerror=alert(1)></template>x", "x"],
        ["<!--><img src=x onerror=alert(1)>-->x", "-->x"],
        ["<textarea><img src=x onerror=alert(1)></textarea>", "<img src=x onerror=alert(1)>"],
        ["&lt;img src=x onerror=alert(1)&gt;", "<img src=x onerror=alert(1)>"],
        ['<img data-mx-emoticon src="javascript:alert(1)" alt="x">', "x"],
        ['<img data-mx-emoticon src="mxc://a/b&quot; onerror=&quot;alert(1)" alt="x">', "x"],
        ['<img data-mx-emoticon src="mxc://a/../../_matrix/client/v3/logout" alt="x">', "x"],
        [
            '<img data-mx-emoticon src="mxc://a/b" alt="&quot; onerror=&quot;alert(1)" title="\'><script>">',
            '" onerror="alert(1)',
        ],
        ['<b>x</b><base href="https://evil.example/">', "x"],
        ['<b is="x-evil">x</b>', "x"],
    ];
    it.each(ATTACKS)("renders %s inertly", (body, displayname) => {
        const out = formattedDisplayNameHtml(html(body), displayname, toHttp);
        expectInert(out);
        if (out !== undefined) expect(out).not.toMatch(/<(?!\/?(b|strong|i|em|u|s|del|img)[\s>/])/i);
    });

    it("doesn't use an emoji whose http URL isn't http(s)", () => {
        const out = formattedDisplayNameHtml(
            html('<img data-mx-emoticon src="mxc://a/b" alt="x">'),
            "x",
            () => "javascript:alert(1)",
        );
        expect(out).toBe("x");
    });
});

describe("getRawFormattedDisplayName", () => {
    it("reads the unstable key, then the stable one", () => {
        expect(
            getRawFormattedDisplayName({ "org.matrix.msc4589.formatted_displayname": 1, "m.formatted_displayname": 2 }),
        ).toBe(1);
        expect(getRawFormattedDisplayName({ "m.formatted_displayname": 2 })).toBe(2);
    });
});

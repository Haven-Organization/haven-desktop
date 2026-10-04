/*
 * Social Overlay - postBody tests
 *
 * MSC4501's social.body/social.formatted_body replace the stock fields whenever present, even as
 * an empty string - how a sender keeps a plain boost caption-free in Social while ordinary room
 * timelines still get a "🔁 X reposted Y's post" body.
 */

import { describe, it, expect } from "vitest";

import { hasPostBodyOverride, hasPostBodyOverrideField, resolvePostBody, resolvePostBodyString } from "./postBody";

const BODY = "org.matrix.msc4501.social.body";
const FORMATTED = "org.matrix.msc4501.social.formatted_body";

/** Shaped like a real bridged plain boost: stock fields describe the repost, overrides are empty. */
const emptyOverrideBoost = {
    msgtype: "m.image",
    body: "https://matrix.to/#/!room:example.org/$post?via=example.org",
    format: "org.matrix.custom.html",
    formatted_body: "<p>🔁 q reposted GaryBussy's post</p><blockquote>the original text</blockquote>",
    [BODY]: "",
    [FORMATTED]: "",
};

describe("resolvePostBody", () => {
    it("uses filled-out overrides in place of the stock fields", () => {
        const resolved: Record<string, any> = resolvePostBody({
            body: "stock",
            formatted_body: "<b>stock</b>",
            [BODY]: "social",
            [FORMATTED]: "<i>social</i>",
        });
        expect(resolved.body).toBe("social");
        expect(resolved.formatted_body).toBe("<i>social</i>");
        expect(resolved.format).toBe("org.matrix.custom.html");
    });

    it("treats empty overrides as overrides too, blanking out the stock fields", () => {
        const resolved = resolvePostBody(emptyOverrideBoost);
        expect(resolved.body).toBe("");
        expect(resolved.formatted_body).toBe("");
    });

    it("only overrides the field that's actually present", () => {
        const resolved = resolvePostBody({ body: "stock", formatted_body: "<b>stock</b>", [BODY]: "" });
        expect(resolved.body).toBe("");
        expect(resolved.formatted_body).toBe("<b>stock</b>");
    });

    it("returns the same object when neither override is present", () => {
        const content = { body: "stock" };
        expect(resolvePostBody(content)).toBe(content);
    });
});

describe("resolvePostBodyString", () => {
    it("returns an empty override rather than falling back to the stock body", () => {
        expect(resolvePostBodyString(emptyOverrideBoost)).toBe("");
    });

    it("falls back to the stock body when there's no override", () => {
        expect(resolvePostBodyString({ body: "stock" })).toBe("stock");
    });
});

describe("hasPostBodyOverride / hasPostBodyOverrideField", () => {
    it("an empty override is present but isn't a caption", () => {
        expect(hasPostBodyOverrideField(emptyOverrideBoost)).toBe(true);
        expect(hasPostBodyOverride(emptyOverrideBoost)).toBe(false);
    });

    it("a filled-out override is both", () => {
        expect(hasPostBodyOverrideField({ [BODY]: "caption" })).toBe(true);
        expect(hasPostBodyOverride({ [BODY]: "caption" })).toBe(true);
    });

    it("neither when no override field exists", () => {
        expect(hasPostBodyOverrideField({ body: "stock" })).toBe(false);
        expect(hasPostBodyOverride({ body: "stock" })).toBe(false);
    });
});

/*
 * Social Overlay - mentionPills tests
 *
 * Regression coverage for "a user chosen from the Social composer's @ menu is sent as plain text
 * instead of a pill" - see mentionPills.ts.
 */

// @vitest-environment happy-dom
// test-utils transitively imports code that calls window.btoa at module load time - see
// social-actions.test.ts's own identical directive.

import { describe, it, expect, beforeEach } from "vitest";
import { type MatrixClient, type User } from "matrix-js-sdk/src/matrix";
import { createTestClient } from "test-utils";

import { attachMentions, pillifyMentions } from "./mentionPills";

const BOB = "@fedi_bronze_pl.kitsunemimi.club:example.org";

describe("pillifyMentions", () => {
    let client: MatrixClient;

    beforeEach(() => {
        client = createTestClient();
        client.getUser = (id: string) => (id === BOB ? ({ displayName: "Bronze" } as User) : null);
    });

    it("turns a user ID into a pill link carrying their display name", () => {
        const { html, changed } = pillifyMentions(`hi ${BOB} !`, client, null);
        expect(changed).toBe(true);
        expect(html).toBe(`hi <a href="https://matrix.to/#/${BOB}">Bronze</a> !`);
    });

    it("turns a room alias into a pill link carrying the alias", () => {
        const { html } = pillifyMentions("join #haven:example.org", client, null);
        expect(html).toBe('join <a href="https://matrix.to/#/#haven:example.org">#haven:example.org</a>');
    });

    it("leaves IDs inside code and existing links alone", () => {
        const input = `<code>${BOB}</code> <a href="https://example.org">${BOB}</a>`;
        expect(pillifyMentions(input, client, null)).toEqual({ html: input, changed: false });
    });

    it("leaves text without mentions untouched", () => {
        expect(pillifyMentions("mail me at a@b.org<br/>", client, null)).toEqual({
            html: "mail me at a@b.org<br/>",
            changed: false,
        });
    });
});

describe("attachMentions", () => {
    it("lists each mentioned user once, never yourself", () => {
        const content: Record<string, unknown> = {
            formatted_body:
                `<a href="https://matrix.to/#/${BOB}">Bronze</a> <a href="https://matrix.to/#/${BOB}">again</a> ` +
                '<a href="https://matrix.to/#/@me:example.org">me</a> ' +
                '<a href="https://matrix.to/#/#room:example.org">r</a>',
        };
        attachMentions(content, "@me:example.org");
        expect(content["m.mentions"]).toEqual({ user_ids: [BOB] });
    });

    it("adds nothing when no user is mentioned", () => {
        const content: Record<string, unknown> = { body: "hello" };
        attachMentions(content, "@me:example.org");
        expect(content).not.toHaveProperty("m.mentions");
    });
});

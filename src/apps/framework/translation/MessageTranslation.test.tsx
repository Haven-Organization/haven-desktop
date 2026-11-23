// @vitest-environment happy-dom
// Haven: "Translate with <site>" under messages in other languages, and in their options menu.
import React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "test-utils-rtl";
import { mkEvent } from "test-utils";

import SettingsStore from "../../../../element-web/apps/web/src/settings/SettingsStore";
import { loadDetector } from "./detectLanguage";
import { getMenuTranslationService, getTranslatableText, MessageTranslation } from "./MessageTranslation";

function mockSettings(values: Record<string, unknown>): void {
    vi.spyOn(SettingsStore, "getValue").mockImplementation(((name: string) => values[name] ?? null) as never);
}

const GERMAN = "Ich habe heute keine Zeit, vielleicht morgen.";

describe("MessageTranslation", () => {
    beforeAll(async () => {
        await loadDetector();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("links a message in another language to the translation site, naming the site", async () => {
        mockSettings({});
        render(<MessageTranslation text={GERMAN} />);

        const link = await screen.findByRole("link", { name: "Translate with LibreTranslate" });
        const url = new URL(link.getAttribute("href")!);
        expect(url.origin).toBe("https://libretranslate.com");
        expect(url.searchParams.get("q")).toBe(GERMAN);
        expect(url.searchParams.get("source")).toBe("de");
        expect(url.searchParams.get("target")).toBe("en");
        expect(link).toHaveAttribute("target", "_blank");
        expect(link).toHaveAttribute("rel", "noreferrer noopener");
    });

    it("uses the site and language the user picked", async () => {
        mockSettings({ "Haven.translationService": "google", "Haven.translationTargetLanguage": "fr" });
        render(<MessageTranslation text={GERMAN} />);

        const link = await screen.findByRole("link", { name: "Translate with Google Translate" });
        expect(new URL(link.getAttribute("href")!).searchParams.get("tl")).toBe("fr");
    });

    it.each(["See you tomorrow, I don't have time today.", "Billions must appimage", "!img momiji inubashiri cute"])(
        "doesn't offer to translate English (%s)",
        async (text) => {
            mockSettings({});
            const { container } = render(<MessageTranslation text={text} />);
            await waitFor(() => expect(container).toBeEmptyDOMElement());
        },
    );

    it("translates only the lines in another language when the rest is English", async () => {
        mockSettings({});
        render(<MessageTranslation text={"今日はとても暑いですね。\n\nIt's really hot today, isn't it?"} />);

        const link = await screen.findByRole("link", { name: "Translate with LibreTranslate" });
        const url = new URL(link.getAttribute("href")!);
        expect(url.searchParams.get("q")).toBe("今日はとても暑いですね。");
        expect(url.searchParams.get("source")).toBe("ja");
    });

    it("shows nothing when translation is off", () => {
        mockSettings({ "Haven.translationService": "off" });
        const { container } = render(<MessageTranslation text={GERMAN} />);
        expect(container).toBeEmptyDOMElement();
    });
});

describe("getMenuTranslationService", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("offers a site for text that isn't clearly in a language the user reads", () => {
        mockSettings({});
        expect(getMenuTranslationService(GERMAN)?.name).toBe("LibreTranslate");
        expect(getMenuTranslationService("Danke")?.name).toBe("LibreTranslate");
    });

    it("doesn't offer one for English, empty text, or when translation is off", () => {
        mockSettings({});
        expect(getMenuTranslationService("I'll be there in a minute, just finishing up.")).toBeUndefined();
        expect(getMenuTranslationService("  ")).toBeUndefined();
        mockSettings({ "Haven.translationService": "off" });
        expect(getMenuTranslationService(GERMAN)).toBeUndefined();
    });
});

describe("getTranslatableText", () => {
    it("is a text message's body", () => {
        const event = mkEvent({
            event: true,
            type: "m.room.message",
            user: "@alice:example.org",
            room: "!room:example.org",
            content: { msgtype: "m.text", body: GERMAN },
        });
        expect(getTranslatableText(event)).toBe(GERMAN);
    });

    it("leaves out the quoted text of the message replied to", () => {
        const event = mkEvent({
            event: true,
            type: "m.room.message",
            user: "@alice:example.org",
            room: "!room:example.org",
            content: {
                "msgtype": "m.text",
                "body": "> <@bob:example.org> Hello\n\nGuten Morgen",
                "m.relates_to": { "m.in_reply_to": { event_id: "$parent" } },
            },
        });
        expect(getTranslatableText(event)).toBe("Guten Morgen");
    });

    it("is nothing for messages that aren't text", () => {
        const event = mkEvent({
            event: true,
            type: "m.room.message",
            user: "@alice:example.org",
            room: "!room:example.org",
            content: { msgtype: "m.image", body: "photo.jpg" },
        });
        expect(getTranslatableText(event)).toBeUndefined();
    });
});

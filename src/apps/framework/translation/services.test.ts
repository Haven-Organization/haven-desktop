import { describe, expect, it } from "vitest";

import { BUILT_IN_SERVICES, parseHostService, translationLink, type TranslationService } from "./services";

const service = (id: string): TranslationService => BUILT_IN_SERVICES.find((s) => s.id === id)!;

describe("translationLink", () => {
    it("fills in LibreTranslate's link", () => {
        expect(translationLink(service("libretranslate"), "断罪", "en")).toEqual({
            url: "https://libretranslate.com/?source=auto&target=en&q=%E6%96%AD%E7%BD%AA",
            truncated: false,
        });
    });

    it("sends the message's language when it's known", () => {
        expect(translationLink(service("libretranslate"), "断罪", "en", "zh-Hans").url).toBe(
            "https://libretranslate.com/?source=zh-Hans&target=en&q=%E6%96%AD%E7%BD%AA",
        );
        expect(translationLink(service("yandex"), "断罪", "en", "zh-Hant").url).toContain("source_lang=zh&");
    });

    it("uses each site's own language codes", () => {
        expect(translationLink(service("google"), "hola", "zh-Hant").url).toBe(
            "https://translate.google.com/?sl=auto&tl=zh-TW&text=hola&op=translate",
        );
        expect(translationLink(service("bing"), "hola", "tl").url).toContain("to=fil&");
    });

    // DeepL's page stays empty when its link says "auto", or a source code it doesn't take
    // ("zh-hans"), and cuts the text at a "/" unless it's escaped.
    it("gives DeepL the language translated from, in its own codes", () => {
        expect(translationLink(service("deepl"), "えっ…いいんですか？", "en", "ja").url).toBe(
            "https://www.deepl.com/translator#ja/en-us/" + encodeURIComponent("えっ…いいんですか？"),
        );
        expect(translationLink(service("deepl"), "断罪", "en", "zh-Hant").url).toContain("#zh/en-us/");
        expect(translationLink(service("deepl"), "olá", "en", "pt-BR").url).toContain("#pt/en-us/");
    });

    it("gives DeepL a language other than the target when the message's isn't known", () => {
        expect(translationLink(service("deepl"), "hola", "fr").url).toContain("#en/fr/");
        expect(translationLink(service("deepl"), "hola", "en").url).toContain("#de/en-us/");
    });

    it("escapes slashes for DeepL", () => {
        expect(translationLink(service("deepl"), "1/2 C:\\temp", "en", "de").url).toBe(
            "https://www.deepl.com/translator#de/en-us/" + encodeURIComponent("1\\/2 C:\\\\temp"),
        );
        expect(translationLink(service("google"), "1/2", "en", "de").url).toContain("text=1%2F2&");
    });

    it("cuts text longer than the site takes, at a word break", () => {
        const text = "word ".repeat(500);
        const link = translationLink(service("bing"), text, "en");
        expect(link.truncated).toBe(true);
        const sent = decodeURIComponent(new URL(link.url).searchParams.get("text")!);
        expect(sent.endsWith("word …")).toBe(true);
        expect(Array.from(sent).length).toBeLessThanOrEqual(1002);
    });

    it("keeps the link short enough for any server", () => {
        const link = translationLink(service("yandex"), "断".repeat(5000), "en");
        expect(link.truncated).toBe(true);
        expect(link.url.length).toBeLessThanOrEqual(8000);
        expect(link.url.length).toBeGreaterThan(7000);
    });
});

describe("parseHostService", () => {
    it("takes a named https link with {text}", () => {
        expect(
            parseHostService(
                { id: "ours", name: "Our LibreTranslate", url: "https://lt.example.org/?q={text}&target={target}" },
                0,
            ),
        ).toEqual({ id: "ours", name: "Our LibreTranslate", url: "https://lt.example.org/?q={text}&target={target}" });
        expect(parseHostService({ name: "Ours", url: "https://lt.example.org/#{text}" }, 2)?.id).toBe("host-2");
    });

    it("ignores anything else", () => {
        expect(parseHostService({ name: "Ours", url: "http://lt.example.org/?q={text}" }, 0)).toBeUndefined();
        expect(parseHostService({ name: "Ours", url: "https://lt.example.org/" }, 0)).toBeUndefined();
        expect(parseHostService({ url: "https://lt.example.org/?q={text}" }, 0)).toBeUndefined();
        expect(parseHostService("nope", 0)).toBeUndefined();
    });
});

import { francAll } from "franc";
import { describe, expect, it } from "vitest";

import { detectLanguage, textForDetection } from "./detectLanguage";

const english = new Set(["en"]);
const detect = (text: string, readable: ReadonlySet<string> = english): ReturnType<typeof detectLanguage> =>
    detectLanguage(text, readable, francAll);

describe("detectLanguage", () => {
    it.each([
        ["Hola, ¿cómo estás? Vamos a la playa mañana.", "es"],
        ["Ich habe heute keine Zeit, vielleicht morgen.", "de"],
        ["Je pense que c'est une bonne idée, on en parle demain.", "fr"],
        ["Det är en bra idé, vi pratar om det imorgon.", "sv"],
        ["Tämä on hyvä idea, puhutaan siitä huomenna.", "fi"],
        ["Bom dia, tudo bem com você?", "pt"],
        ["Buongiorno, come stai oggi?", "it"],
        ["Это хорошая идея, давай обсудим завтра.", "ru"],
        ["Це гарна ідея, давай обговоримо завтра.", "uk"],
        ["今日はとても暑いですね。", "ja"],
        ["我们明天再说吧", "zh-Hans"],
        ["我們明天再說吧", "zh-Hant"],
        ["안녕하세요, 반갑습니다", "ko"],
        ["Καλημέρα, τι κάνεις;", "el"],
    ])("detects %s as %s, confidently", (text, language) => {
        expect(detect(text)).toEqual({ language, confident: true });
    });

    it("takes two Chinese characters as Chinese, confidently", () => {
        // Could be Japanese too (no kana to tell); the user can change it after translating.
        expect(detect("断罪")).toEqual({ language: "zh-Hans", confident: true });
    });

    it("isn't confident about a language franc can't separate from a neighbor", () => {
        // Norwegian, Danish and Swedish score close together on a short sentence.
        expect(detect("Det er en god idé, vi snakker om det i morgen.")?.confident).toBe(false);
    });

    it("recognizes casual English, which franc on its own takes for French or Scots", () => {
        expect(detect("great idea, let's talk about it tomorrow then")).toEqual({ language: "en", confident: true });
        expect(detect("This is fine")).toEqual({ language: "en", confident: true });
    });

    it("doesn't take Spanish built from words English shares for English", () => {
        // ("no", "me", "a", ...). franc's answer may still be a neighbor such as Galician.
        expect(detect("no me gusta nada esta idea, de verdad")?.language).not.toBe("en");
    });

    it("answers with a language the user reads when franc scores it about as well", () => {
        // franc's top pick here is Swedish, with Norwegian Bokmål close behind.
        const readsNorwegian = new Set(["nb"]);
        expect(detect("Det er en god idé, vi snakker om det i morgen.", readsNorwegian)?.language).toBe("nb");
    });

    it("can't tell text that's too short, or has no words", () => {
        expect(detect("ok")).toBeUndefined();
        expect(detect("lol same")).toBeUndefined();
        expect(detect("👍🎉")).toBeUndefined();
        expect(detect("12:30")).toBeUndefined();
        expect(detect("https://example.com/some/long/path @bob:example.org")).toBeUndefined();
    });

    it("needs franc for text in a shared script, unless its letters settle it", () => {
        expect(detectLanguage("Ich habe heute keine Zeit, vielleicht morgen.", english, undefined)).toBeUndefined();
        expect(detectLanguage("Це гарна ідея, давай обговоримо завтра.", english, undefined)?.language).toBe("uk");
        expect(detectLanguage("今日はとても暑いですね。", english, undefined)?.language).toBe("ja");
    });

    it("skips Macedonian, which isn't detected, rather than calling it Bulgarian or Serbian", () => {
        expect(detect("Ова е добра идеја, ќе зборуваме утре.")).toBeUndefined();
    });
});

describe("textForDetection", () => {
    it("leaves out links, code, user IDs and shortcodes", () => {
        const text = textForDetection(
            "Hola https://example.com/x `code here` @alice:example.org :smile: ```\nblock\n``` amigo",
        );
        expect(text).not.toMatch(/example|code|alice|smile|block/);
        expect(text).toMatch(/Hola/);
        expect(text).toMatch(/amigo/);
    });
});

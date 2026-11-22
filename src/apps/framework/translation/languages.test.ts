import { describe, expect, it } from "vitest";

import { normalizeLanguage } from "./languages";

describe("normalizeLanguage", () => {
    it.each([
        ["en", "en"],
        ["en_US", "en"],
        ["pt", "pt"],
        ["pt-BR", "pt-BR"],
        ["pt_br", "pt-BR"],
        ["zh_Hans", "zh-Hans"],
        ["zh-CN", "zh-Hans"],
        ["zh_Hant", "zh-Hant"],
        ["zh-TW", "zh-Hant"],
        ["nb_NO", "nb"],
        ["no", "nb"],
        ["fil", "tl"],
        ["iw", "he"],
    ])("maps %s to %s", (tag, language) => {
        expect(normalizeLanguage(tag)).toBe(language);
    });

    it("has nothing for an empty tag", () => {
        expect(normalizeLanguage("")).toBeUndefined();
    });
});

// @vitest-environment happy-dom
// Haven: which translation site and language "Translate with ..." uses, from the user's settings and the host's config.
import { afterEach, describe, expect, it, vi } from "vitest";

import SdkConfig from "../../../../element-web/apps/web/src/SdkConfig";
import SettingsStore from "../../../../element-web/apps/web/src/settings/SettingsStore";
import { getTargetLanguage } from "./languages";
import { getAvailableServices, getHostDefaultServiceId, getTranslationService, isForeign } from "./translationSettings";

function mockSettings(values: Record<string, unknown>): void {
    vi.spyOn(SettingsStore, "getValue").mockImplementation(((name: string) => values[name] ?? null) as never);
}

function hostConfig(translation: unknown): void {
    SdkConfig.put({ haven: { translation } } as never);
}

describe("translation settings", () => {
    afterEach(() => {
        SdkConfig.reset();
        vi.restoreAllMocks();
    });

    it("uses LibreTranslate until the user or host picks something else", () => {
        mockSettings({});
        expect(getTranslationService()?.name).toBe("LibreTranslate");
    });

    it("uses the site the user picked", () => {
        mockSettings({ "Haven.translationService": "google" });
        expect(getTranslationService()?.name).toBe("Google Translate");
    });

    it("is off when the user turns it off", () => {
        mockSettings({ "Haven.translationService": "off" });
        expect(getTranslationService()).toBeUndefined();
    });

    it("is off for everyone when the host turns it off, whatever the user picked", () => {
        hostConfig({ enabled: false });
        mockSettings({ "Haven.translationService": "google" });
        expect(getTranslationService()).toBeUndefined();
    });

    it("uses the host's default site until the user picks one", () => {
        hostConfig({ default_service: "deepl" });
        mockSettings({});
        expect(getHostDefaultServiceId()).toBe("deepl");
        expect(getTranslationService()?.name).toBe("DeepL");
    });

    it("can be off by default on a host, until the user turns it on", () => {
        hostConfig({ default_service: "off" });
        mockSettings({});
        expect(getTranslationService()).toBeUndefined();
        mockSettings({ "Haven.translationService": "bing" });
        expect(getTranslationService()?.name).toBe("Bing Translator");
    });

    it("offers the host's own sites, and falls back to the default when a picked one is gone", () => {
        hostConfig({
            services: [{ id: "ours", name: "Our Translate", url: "https://translate.example.org/?q={text}" }],
        });
        expect(getAvailableServices().map((s) => s.id)).toContain("ours");
        mockSettings({ "Haven.translationService": "ours" });
        expect(getTranslationService()?.name).toBe("Our Translate");

        SdkConfig.reset();
        expect(getTranslationService()?.name).toBe("LibreTranslate");
    });

    it("translates into the language the user picked, or else the app's language", () => {
        mockSettings({ "Haven.translationTargetLanguage": "ja" });
        expect(getTargetLanguage()).toBe("ja");
        mockSettings({ "Haven.translationTargetLanguage": "not-a-language" });
        expect(getTargetLanguage()).toBe("en");
    });

    it("treats the language being translated into as one the user reads", () => {
        expect(isForeign({ language: "ja", confident: true }, "ja")).toBe(false);
        expect(isForeign({ language: "ja", confident: true }, "en")).toBe(true);
        expect(isForeign(undefined, "en")).toBe(false);
    });
});

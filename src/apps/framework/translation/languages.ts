/*
 * Haven - message translation: the languages messages can be translated into, and the languages
 * the user reads.
 */

import { getUserLanguage } from "../../../../element-web/apps/web/src/i18n/settings";
import SettingsStore from "../../../../element-web/apps/web/src/settings/SettingsStore";

/**
 * The languages a user can pick to translate into: the ones LibreTranslate (the default service)
 * covers. Every service is sent its own code for each (see services.ts).
 */
export const TARGET_LANGUAGES: readonly string[] = [
    "ar",
    "az",
    "bg",
    "bn",
    "ca",
    "cs",
    "da",
    "de",
    "el",
    "en",
    "eo",
    "es",
    "et",
    "eu",
    "fa",
    "fi",
    "fr",
    "ga",
    "gl",
    "he",
    "hi",
    "hu",
    "id",
    "it",
    "ja",
    "ko",
    "ky",
    "lt",
    "lv",
    "ms",
    "nb",
    "nl",
    "pl",
    "pt",
    "pt-BR",
    "ro",
    "ru",
    "sk",
    "sl",
    "sq",
    "sr",
    "sv",
    "sw",
    "th",
    "tl",
    "tr",
    "uk",
    "ur",
    "vi",
    "zh-Hans",
    "zh-Hant",
];

const TARGETS = new Set(TARGET_LANGUAGES);

/**
 * A language tag such as "en_US", "pt-BR", "zh_Hant" or "no" as one of the codes used here ("en",
 * "pt-BR", "zh-Hant", "nb"): Chinese as Simplified or Traditional, Brazilian Portuguese kept apart,
 * and otherwise just the language. Undefined for an empty tag.
 */
export function normalizeLanguage(tag: string): string | undefined {
    const parts = tag.trim().replace(/_/g, "-").toLowerCase().split("-");
    const base = parts[0];
    if (!base) return undefined;
    if (base === "zh") {
        const traditional = parts.some((p) => p === "hant" || p === "tw" || p === "hk" || p === "mo");
        return traditional ? "zh-Hant" : "zh-Hans";
    }
    if (base === "pt" && parts.includes("br")) return "pt-BR";
    if (base === "no" || base === "nob") return "nb";
    if (base === "fil") return "tl";
    if (base === "iw") return "he";
    if (base === "in") return "id";
    return base;
}

/** "pt" for "pt-BR"; any other code as it is (Chinese's two forms are told apart by detection). */
function withoutRegion(language: string): string {
    return language === "pt-BR" ? "pt" : language;
}

/** The app's own language, as a translation target, if it's one of TARGET_LANGUAGES. */
export function getAppTargetLanguage(): string | undefined {
    const language = normalizeLanguage(getUserLanguage());
    if (!language) return undefined;
    if (TARGETS.has(language)) return language;
    const base = withoutRegion(language);
    return TARGETS.has(base) ? base : undefined;
}

/**
 * The language messages are translated into: the user's choice from Settings > Preferences >
 * Translation ("Haven.translationTargetLanguage"), or else the app's language, or else English.
 */
export function getTargetLanguage(chosen?: string | null): string {
    const own = chosen === undefined ? SettingsStore.getValue("Haven.translationTargetLanguage") : chosen;
    if (typeof own === "string" && TARGETS.has(own)) return own;
    return getAppTargetLanguage() ?? "en";
}

/**
 * Languages the user reads: the one they translate into, the app's language and the browser's
 * preferred languages.
 */
export function getReadableLanguages(target: string = getTargetLanguage()): Set<string> {
    const tags = [target, getUserLanguage(), ...(typeof navigator !== "undefined" ? (navigator.languages ?? []) : [])];
    const languages = new Set<string>();
    for (const tag of tags) {
        const language = normalizeLanguage(tag);
        if (!language) continue;
        languages.add(withoutRegion(language));
        // Someone who reads one Norwegian written standard reads the other.
        if (language === "nb") languages.add("nn");
        if (language === "nn") languages.add("nb");
    }
    return languages;
}

/** A language's name, in the app's language ("Japanese", "Simplified Chinese"). */
export function languageName(language: string): string {
    try {
        const names = new Intl.DisplayNames([getUserLanguage().replace(/_/g, "-"), "en"], { type: "language" });
        return names.of(language) ?? language;
    } catch {
        return language;
    }
}

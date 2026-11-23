/*
 * Haven - message translation: the translation sites a message can be opened in.
 *
 * Haven doesn't translate anything itself. "Translate with <service>" opens the chosen site in a
 * new tab (the system browser, in the desktop app) with the message's text and the language to
 * translate into already filled in, which every site here takes from its link. The button names
 * the site, so it's clear where the text is going.
 */

export interface TranslationService {
    /** Stored in the user's setting ("Haven.translationService"). */
    id: string;
    /** Shown in "Translate with <name>". */
    name: string;
    /**
     * The link to open. "{text}" is replaced with the message's text, "{target}" with the language
     * to translate into and "{source}" with the message's language ("auto" when it isn't known, unless
     * `unknownSource` says otherwise),
     * all URL-encoded.
     */
    url: string;
    /** The site's own language codes, where they differ from Haven's (see languages.ts). */
    languageCodes?: Record<string, string>;
    /** The site's codes for the language translated from, where they differ from `languageCodes`. */
    sourceCodes?: Record<string, string>;
    /**
     * For a site that can't detect the language from its link (it opens empty with "auto"): the
     * language to send when the message's isn't known. The site corrects it once it has the text.
     * It mustn't be the language translated into, so `otherwise` is sent when it is.
     */
    unknownSource?: { language: string; otherwise: string };
    /** Whether "/" and "\" in the text are sent as "\/" and "\\", which DeepL's links need. */
    escapeSlashes?: boolean;
    /** The most text the site takes at once, in characters. Longer messages are cut short. */
    maxTextLength?: number;
}

export const DEFAULT_SERVICE_ID = "libretranslate";

/** The value of "Haven.translationService" that turns translation off. */
export const SERVICE_OFF = "off";

export const BUILT_IN_SERVICES: readonly TranslationService[] = [
    {
        id: "libretranslate",
        name: "LibreTranslate",
        url: "https://libretranslate.com/?source={source}&target={target}&q={text}",
        maxTextLength: 2000,
    },
    {
        id: "google",
        name: "Google Translate",
        url: "https://translate.google.com/?sl={source}&tl={target}&text={text}&op=translate",
        languageCodes: { "zh-Hans": "zh-CN", "zh-Hant": "zh-TW", "pt-BR": "pt", "nb": "no", "nn": "no" },
        maxTextLength: 5000,
    },
    {
        id: "deepl",
        name: "DeepL",
        // DeepL opens empty unless its link names the language translated from, and its codes for
        // that differ from the ones for the language translated into ("en" and "en-us").
        url: "https://www.deepl.com/translator#{source}/{target}/{text}",
        languageCodes: { "en": "en-us", "pt": "pt-pt", "pt-BR": "pt-br", "zh-Hans": "zh-hans", "zh-Hant": "zh-hant" },
        sourceCodes: { "pt-BR": "pt", "zh-Hans": "zh", "zh-Hant": "zh" },
        unknownSource: { language: "en", otherwise: "de" },
        escapeSlashes: true,
        maxTextLength: 1500,
    },
    {
        id: "bing",
        name: "Bing Translator",
        url: "https://www.bing.com/translator?from={source}&to={target}&text={text}",
        languageCodes: { "pt-BR": "pt", "tl": "fil", "sr": "sr-Cyrl" },
        maxTextLength: 1000,
    },
    {
        id: "yandex",
        name: "Yandex Translate",
        url: "https://translate.yandex.com/?source_lang={source}&target_lang={target}&text={text}",
        languageCodes: { "zh-Hans": "zh", "zh-Hant": "zh", "pt-BR": "pt", "nb": "no", "nn": "no" },
        maxTextLength: 10000,
    },
];

/**
 * The longest link opened. Servers commonly refuse requests much over 8 KB; text after a "#" (as
 * DeepL takes it) never reaches the server, but browsers and the desktop app still pass the link
 * around whole.
 */
const MAX_URL_LENGTH = 8000;

export interface TranslationLink {
    url: string;
    /** Whether the message was too long to send whole, and only its start was sent. */
    truncated: boolean;
}

function fill(service: TranslationService, text: string, target: string, source: string | undefined): string {
    const code = (language: string): string => encodeURIComponent(service.languageCodes?.[language] ?? language);
    const sourceCode = (language: string): string =>
        encodeURIComponent(service.sourceCodes?.[language] ?? language.toLowerCase());
    const unknown = service.unknownSource;
    const from = source ?? (unknown && (target === unknown.language ? unknown.otherwise : unknown.language));
    const escaped = service.escapeSlashes ? text.replace(/[\\/]/g, "\\$&") : text;
    return service.url
        .replace(/\{target\}/g, code(target))
        .replace(/\{source\}/g, from ? (service.sourceCodes ? sourceCode(from) : code(from)) : "auto")
        .replace(/\{text\}/g, encodeURIComponent(escaped));
}

/**
 * The link that opens `text` in `service`, to be translated from `source` (the site detects it
 * when that's undefined) into `target`. Text too long for the site, or for a link, is cut short,
 * at a word break where there's one close by.
 */
export function translationLink(
    service: TranslationService,
    text: string,
    target: string,
    source?: string,
): TranslationLink {
    const chars = Array.from(text.trim());
    const linkFor = (length: number): string => {
        if (length >= chars.length) return fill(service, chars.join(""), target, source);
        let cut = chars.slice(0, length).join("");
        const lastBreak = cut.search(/\s\S*$/);
        if (lastBreak > cut.length * 0.8) cut = cut.slice(0, lastBreak);
        return fill(service, `${cut} …`, target, source);
    };
    let length = Math.min(chars.length, service.maxTextLength ?? chars.length);
    let url = linkFor(length);
    while (url.length > MAX_URL_LENGTH && length > 0) {
        // A character takes up to 9 once encoded ("%E6%96%AD"), so this never cuts too much.
        length = Math.max(0, length - Math.ceil((url.length - MAX_URL_LENGTH) / 9));
        url = linkFor(length);
    }
    return { url, truncated: length < chars.length };
}

/**
 * A translation site a host adds in config.json ("haven.translation.services"), if it's usable:
 * a name, and an https link with "{text}" in it.
 */
export function parseHostService(value: unknown, index: number): TranslationService | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const { id, name, url } = value as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim() || typeof url !== "string" || !url.includes("{text}")) {
        return undefined;
    }
    try {
        if (new URL(url.replace(/\{(text|target|source)\}/g, "x")).protocol !== "https:") return undefined;
    } catch {
        return undefined;
    }
    return {
        id: typeof id === "string" && id && id !== SERVICE_OFF ? id : `host-${index}`,
        name: name.trim(),
        url,
    };
}

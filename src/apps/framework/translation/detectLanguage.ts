/*
 * Haven - message translation: works out which language a message is in, on this device, to
 * decide whether to offer translating it.
 *
 * Most writing systems are only used by one of the languages detected here (Japanese kana, Korean
 * Hangul, Thai, Greek, Hebrew, ...), so the script alone settles it. Text in a shared script
 * (Latin, Cyrillic, Arabic, Devanagari) goes to franc (https://github.com/wooorm/franc), a small
 * trigram-based detector, loaded the first time it's needed.
 *
 * Short messages are hard to place, so detection says whether it's confident: only a confident
 * detection gets a Translate button under the message. "Translate" in the message's options menu
 * accepts a less certain one, and the user can correct the language afterwards.
 */

import type { francAll as FrancAll } from "franc";

export interface DetectedLanguage {
    /** A language, such as "ja" or "zh-Hans" (see languages.ts). */
    language: string;
    /** Whether it's certain enough to offer a translation without being asked. */
    confident: boolean;
}

type FrancAllFunction = typeof FrancAll;

let francAll: FrancAllFunction | undefined;
let francLoading: Promise<FrancAllFunction> | undefined;
/** Common English words (see englishWords.ts), loaded with franc. */
let englishWords: ReadonlySet<string> | undefined;

/** Loads the detector for shared scripts, and the English word list that goes with it. */
export function loadDetector(): Promise<FrancAllFunction> {
    francLoading ??= Promise.all([import("franc"), import("./englishWords")]).then(([franc, words]) => {
        englishWords = new Set([...words.default.split(" "), ...ENGLISH_SLANG]);
        francAll = franc.francAll;
        return franc.francAll;
    });
    return francLoading;
}

/** The detector for shared scripts, if it's loaded. */
export function getLoadedDetector(): FrancAllFunction | undefined {
    return francAll;
}

/** franc's ISO 639-3 codes, for the languages detected here. */
const FRANC_TO_LANGUAGE: Record<string, string> = {
    afr: "af",
    als: "sq",
    arb: "ar",
    azj: "az",
    bel: "be",
    bos: "bs",
    bul: "bg",
    cat: "ca",
    ces: "cs",
    dan: "da",
    deu: "de",
    ekk: "et",
    eng: "en",
    fin: "fi",
    fra: "fr",
    glg: "gl",
    hin: "hi",
    hrv: "hr",
    hun: "hu",
    ind: "id",
    ita: "it",
    lit: "lt",
    lvs: "lv",
    mar: "mr",
    nld: "nl",
    nno: "nn",
    nob: "nb",
    pes: "fa",
    pol: "pl",
    por: "pt",
    prs: "fa",
    ron: "ro",
    rus: "ru",
    slk: "sk",
    slv: "sl",
    spa: "es",
    srp: "sr",
    swe: "sv",
    tgl: "tl",
    tur: "tr",
    uig: "ug",
    ukr: "uk",
    urd: "ur",
    vie: "vi",
    zlm: "ms",
};

/**
 * The languages franc chooses between for each shared script. A few that aren't detected are included
 * (Macedonian, Nepali), so text in them isn't mistaken for a neighbor that is.
 */
const FRANC_CANDIDATES: Record<"latin" | "cyrillic" | "arabic" | "devanagari", string[]> = {
    latin: [
        "afr",
        "als",
        "azj",
        "bos",
        "cat",
        "ces",
        "dan",
        "deu",
        "ekk",
        "eng",
        "fin",
        "fra",
        "glg",
        "hrv",
        "hun",
        "ind",
        "ita",
        "lit",
        "lvs",
        "nld",
        "nno",
        "nob",
        "pol",
        "por",
        "ron",
        "slk",
        "slv",
        "spa",
        "swe",
        "tgl",
        "tur",
        "vie",
        "zlm",
    ],
    cyrillic: ["bel", "bul", "mkd", "rus", "srp", "ukr"],
    arabic: ["arb", "pes", "prs", "uig", "urd"],
    devanagari: ["hin", "mar", "npi"],
};

/** Scripts only one of the detected languages is written in. */
const SINGLE_LANGUAGE_SCRIPTS: Array<[RegExp, string]> = [
    [/\p{Script=Hangul}/gu, "ko"],
    [/\p{Script=Thai}/gu, "th"],
    [/\p{Script=Greek}/gu, "el"],
    [/\p{Script=Hebrew}/gu, "he"],
    [/\p{Script=Bengali}/gu, "bn"],
    [/\p{Script=Gujarati}/gu, "gu"],
    [/\p{Script=Kannada}/gu, "kn"],
    [/\p{Script=Malayalam}/gu, "ml"],
    [/\p{Script=Tamil}/gu, "ta"],
    [/\p{Script=Telugu}/gu, "te"],
];

const SHARED_SCRIPTS: Array<[RegExp, keyof typeof FRANC_CANDIDATES]> = [
    [/\p{Script=Latin}/gu, "latin"],
    [/\p{Script=Cyrillic}/gu, "cyrillic"],
    [/\p{Script=Arabic}/gu, "arabic"],
    [/\p{Script=Devanagari}/gu, "devanagari"],
];

/**
 * Letters only one of the languages sharing a script uses (among those franc tells apart), which
 * settle it even for a message too short for franc. Checked in order.
 */
const DISTINCTIVE_LETTERS: Array<[RegExp, string | undefined]> = [
    // Cyrillic. Macedonian isn't detected: undefined, so it isn't taken for Bulgarian or Serbian.
    [/[ѓќѕЃЌЅ]/u, undefined],
    [/[ўЎ]/u, "be"],
    [/[їєґЇЄҐ]/u, "uk"],
    [/[іІ]/u, "uk"],
    [/[ђћџјљњЂЋЏЈЉЊ]/u, "sr"],
    [/[ыэёЫЭЁ]/u, "ru"],
    // Latin.
    [/[ůěřŮĚŘ]/u, "cs"],
    [/[ľĺŕĽĹŔ]/u, "sk"],
    [/[łąęśźńŁĄĘŚŹŃ]/u, "pl"],
    [/[őűŐŰ]/u, "hu"],
    [/[șțȘȚ]/u, "ro"],
    [/[ğıĞİ]/u, "tr"],
    [/[ơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹƠƯ]/u, "vi"],
    [/[þðÞÐ]/u, "is"],
    [/[ėįųĖĮŲ]/u, "lt"],
    [/[ķļņģĶĻŅĢ]/u, "lv"],
    [/[ħĦ]/u, "mt"],
    [/[¿¡]/u, "es"],
    [/ß/u, "de"],
];

/**
 * Very common English words, leaving out ones just as common in other languages ("no", "me",
 * "was", "will", "also", ...). franc places casual English poorly (often as French or Scots), and
 * English is what most people read Haven in, so text made up largely of these is English.
 */
const ENGLISH_WORDS = new Set(
    (
        "about all and are at be because but by can could did does don't for from get got had has " +
        "have him his how i'm if is it it's its just know let's like more my not now of one our out " +
        "really she some that that's the their them then there they think this to too up we what " +
        "when which who with would yeah yes you your"
    ).split(" "),
);
/** The share of a text's words that have to be common English ones for it to be English. */
const ENGLISH_WORD_SHARE = 0.35;

/**
 * Words the English word list doesn't have: "i" (which it only has as "I"), contractions typed
 * without their apostrophe, and chat words.
 */
const ENGLISH_SLANG = (
    "i im ive ill id dont cant wont didnt doesnt isnt wasnt arent werent couldnt shouldnt wouldnt " +
    "thats whats theres youre theyre lets " +
    "afk btw brb fr gonna gotta idk imho imo irl kinda lmao lmfao lol ngl nvm ok okay omg pls plz rn " +
    "smh tbh thx ty wanna wtf yeah yep yup linux " +
    // Left out of SCOWL's lists.
    "shit shitty bullshit fuck fucks fucked fucking fuckin motherfucker"
).split(" ");

/** Laughter spelled out in English: "haha", "hahaaaa", "ahaha", "hehe", "heh". */
const LAUGHTER = /^a?(?:h+a+)+h*$|^(?:h+e+)+h*$/;

function isEnglishWord(word: string): boolean {
    return englishWords!.has(word) || englishWords!.has(word.replace(/'s$/, "")) || LAUGHTER.test(word);
}

/**
 * The share of a text's words that have to be in the English word list (see englishWords.ts) for
 * it to be English. Casual English made of slang, names or product words still has at least half
 * its words in the list ("flatpak builds broke again lmao", "i also guessed taj mahal"), which
 * franc can't tell on its own. A few short words are shared with other languages ("on", "idea",
 * "come"), so a very short foreign message can pass for English; it then only loses the link
 * under it, and its options menu still offers to translate it.
 */
const ENGLISH_DICTIONARY_SHARE = 0.5;

/** The share of `text`'s words in the English word list, or 0 before the list is loaded. */
function englishShare(text: string): number {
    if (!englishWords) return 0;
    const words = text.toLowerCase().match(/\p{L}[\p{L}']*/gu) ?? [];
    return words.length === 0 ? 0 : words.filter(isEnglishWord).length / words.length;
}

function mostlyEnglishWords(text: string): boolean {
    return (text.match(/\p{L}[\p{L}']*/gu)?.length ?? 0) >= 2 && englishShare(text) >= ENGLISH_DICTIONARY_SHARE;
}

/**
 * True when every word of `text` is in the English word list - for text too short to detect
 * ("lmao", "ok"), which is then not worth offering to translate. False before the list is loaded.
 */
export function onlyEnglishWords(text: string): boolean {
    if (!englishWords) return false;
    const words = textForDetection(text).toLowerCase().match(/\p{L}[\p{L}']*/gu) ?? [];
    return words.length > 0 && words.every(isEnglishWord);
}

function looksEnglish(text: string): boolean {
    const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
    if (words.length < 3) return false;
    const english = words.filter((word) => ENGLISH_WORDS.has(word)).length;
    return english / words.length >= ENGLISH_WORD_SHARE;
}

const HAN = /\p{Script=Han}/gu;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/gu;

/**
 * Common characters written differently in Simplified and Traditional Chinese, pairwise: each
 * Simplified one is at the same position as its Traditional form.
 */
const SIMPLIFIED =
    "们这说国来时会对为个与发经现进样么问开关东车门见长头马书话语读买卖钱电过还没让给从学习业员难观认识讲记变应边运远连华乐图爱气体动实当点听写无义万网号场张欢红线级总处农产亲机师历声选战";
const TRADITIONAL =
    "們這說國來時會對為個與發經現進樣麼問開關東車門見長頭馬書話語讀買賣錢電過還沒讓給從學習業員難觀認識講記變應邊運遠連華樂圖愛氣體動實當點聽寫無義萬網號場張歡紅線級總處農產親機師歷聲選戰";

/** Minimum letters in a shared script before franc's answer counts as confident. */
const CONFIDENT_SHARED_SCRIPT_LETTERS = 20;
/**
 * Minimum words for franc's answer to count as confident. Fewer are often names or slang, which
 * franc places in whatever language they happen to look like ("momiji inubashiri cute" as Italian).
 */
const CONFIDENT_SHARED_SCRIPT_WORDS = 4;
/** Minimum letters for a detection from distinctive letters to count as confident. */
const CONFIDENT_DISTINCTIVE_LETTERS = 8;
/** Fewer letters than this in a shared script are too few to guess from at all. */
const MIN_SHARED_SCRIPT_LETTERS = 8;
/**
 * A language the user reads that franc scores at least this close to its best match is taken to
 * be the language: franc often ranks a neighbor of the right language first on short text.
 */
const READABLE_MARGIN = 0.1;
/**
 * A language the user reads that franc scores at least this close to its best match makes the
 * best match not confident: short casual text in the user's own language, with slang, names or
 * typos, often scores just under some other language ("nigga q anyfur is joing now" as Tagalog,
 * with English close behind).
 */
const UNSURE_READABLE_MARGIN = 0.2;
/** Minimum letters in a single-language script (2 for Chinese and Japanese) to count as confident. */
const CONFIDENT_SINGLE_SCRIPT_LETTERS = 4;
/**
 * How far below the best match franc's runner-up has to score (scores are relative, the best
 * being 1) for the best one to count as confident.
 */
const CONFIDENT_FRANC_MARGIN = 0.04;

/**
 * The message's words, without a leading bot command, links, code, user and room IDs, @mentions or
 * :shortcodes:.
 */
export function textForDetection(text: string): string {
    return text
        .replace(/^\s*[!/.][\p{L}\p{N}_-]+(?=\s|$)/u, " ")
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/`[^`\n]*`/g, " ")
        .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, " ")
        .replace(/\bwww\.\S+/gi, " ")
        .replace(/\S+@\S+\.\S+/g, " ")
        .replace(/[@#!+][^\s:]+:[\w.-]+(?::\d+)?/g, " ")
        // Fediverse-style mentions, @name or @name@server, which bridged posts keep in their text.
        .replace(/(^|\s)@[\w.-]+(?:@[\w.-]+)?/g, "$1 ")
        .replace(/:[\w+-]+:/g, " ");
}

const count = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0;

function chineseVariant(text: string): "zh-Hans" | "zh-Hant" {
    let simplified = 0;
    let traditional = 0;
    for (const char of text) {
        if (SIMPLIFIED.includes(char)) simplified++;
        else if (TRADITIONAL.includes(char)) traditional++;
    }
    return traditional > simplified ? "zh-Hant" : "zh-Hans";
}

/**
 * The language of a message's text, or undefined if it can't be told. Text in a shared script
 * (Latin, Cyrillic, ...) mostly needs the detector from loadDetector(): without it, that text is
 * undefined unless its letters settle it.
 *
 * `readable` is the languages the user reads (see getReadableLanguages): when the text could well
 * be in one of them, that's the answer.
 */
export function detectLanguage(
    message: string,
    readable: ReadonlySet<string> = new Set(),
    detector: FrancAllFunction | undefined = francAll,
): DetectedLanguage | undefined {
    const text = textForDetection(message);
    const letters = count(text, /\p{L}/gu);
    if (letters === 0) return undefined;

    // Japanese mixes kana with Chinese characters; Chinese has no kana.
    const kana = count(text, KANA);
    const han = count(text, HAN);
    if (kana + han >= letters / 2) {
        if (kana > 0) return { language: "ja", confident: kana + han >= 2 };
        return { language: chineseVariant(text), confident: han >= 2 };
    }

    // The script most of the letters are in.
    let best: { letters: number; language?: string; shared?: keyof typeof FRANC_CANDIDATES } = { letters: 0 };
    for (const [pattern, language] of SINGLE_LANGUAGE_SCRIPTS) {
        const n = count(text, pattern);
        if (n > best.letters) best = { letters: n, language };
    }
    for (const [pattern, shared] of SHARED_SCRIPTS) {
        const n = count(text, pattern);
        if (n > best.letters) best = { letters: n, shared };
    }
    if (best.letters === 0) return undefined;
    if (best.language) {
        return { language: best.language, confident: best.letters >= CONFIDENT_SINGLE_SCRIPT_LETTERS };
    }
    if (!best.shared || best.letters < MIN_SHARED_SCRIPT_LETTERS) return undefined;

    // English first: English text can still mention a letter or mark from another language ("¡ and
    // ¿ become kaomoji").
    if (best.shared === "latin" && (looksEnglish(text) || mostlyEnglishWords(text))) {
        return { language: "en", confident: best.letters >= CONFIDENT_DISTINCTIVE_LETTERS };
    }

    for (const [pattern, language] of DISTINCTIVE_LETTERS) {
        if (pattern.test(text)) {
            return language ? { language, confident: best.letters >= CONFIDENT_DISTINCTIVE_LETTERS } : undefined;
        }
    }

    if (!detector) return undefined;
    const scores = detector(text, { only: FRANC_CANDIDATES[best.shared], minLength: 1 });
    const [top, runnerUp] = scores;
    if (!top) return undefined;
    for (const [code, score] of scores) {
        const language = FRANC_TO_LANGUAGE[code];
        if (score < top[1] - READABLE_MARGIN) break;
        if (language && readable.has(language)) return { language, confident: true };
    }
    const language = FRANC_TO_LANGUAGE[top[0]];
    if (!language) return undefined;
    const margin = top[1] - (runnerUp?.[1] ?? 0);
    const readableCloseBehind = scores.some(
        ([code, score]) =>
            score >= top[1] - UNSURE_READABLE_MARGIN && readable.has(FRANC_TO_LANGUAGE[code] ?? ""),
    );
    return {
        language,
        confident:
            best.letters >= CONFIDENT_SHARED_SCRIPT_LETTERS &&
            count(text, /\p{L}+/gu) >= CONFIDENT_SHARED_SCRIPT_WORDS &&
            margin >= CONFIDENT_FRANC_MARGIN &&
            !readableCloseBehind,
    };
}

/** The writing system most of `text`'s letters are in, such as "latin", "han+kana" or "ko". */
function mainScript(text: string): string | undefined {
    const scripts: Array<[string, number]> = [
        ["han+kana", count(text, HAN) + count(text, KANA)],
        ...SINGLE_LANGUAGE_SCRIPTS.map(([pattern, language]): [string, number] => [language, count(text, pattern)]),
        ...SHARED_SCRIPTS.map(([pattern, shared]): [string, number] => [shared, count(text, pattern)]),
    ];
    let best: [string, number] | undefined;
    for (const entry of scripts) {
        if (entry[1] > (best?.[1] ?? 0)) best = entry;
    }
    return best?.[0];
}

/** The part of a message to translate, and the language it's in. */
export interface ForeignText {
    language: string;
    /** The whole message, or only its lines in `language` when the rest is in a language the user reads. */
    text: string;
    /** Whether `text` is only some of the message's lines. */
    partial: boolean;
}

/**
 * What to translate in a message, when it's confidently in a language the user doesn't read: the
 * whole message, or, when the message as a whole is in one they do read, the lines in the most
 * common other language ("久しぶりですね！" above a paragraph of English). Only lines in another
 * writing system count: a short line in the message's own one is too easy to misplace ("reposted
 * JonnyFever's post" passes for Norwegian), and is part of the message the user can read anyway.
 *
 * `readable` is the languages the user reads, as for detectLanguage.
 */
export function detectForeignText(
    message: string,
    readable: ReadonlySet<string>,
    detector: FrancAllFunction | undefined = francAll,
): ForeignText | undefined {
    const whole = detectLanguage(message, readable, detector);
    if (whole?.confident && !readable.has(whole.language)) {
        return { language: whole.language, text: message, partial: false };
    }
    if (!whole?.confident) return undefined;

    const messageScript = mainScript(textForDetection(message));
    const linesByLanguage = new Map<string, string[]>();
    for (const line of message.split("\n")) {
        if (mainScript(textForDetection(line)) === messageScript) continue;
        const detected = detectLanguage(line, readable, detector);
        if (!detected?.confident || readable.has(detected.language)) continue;
        linesByLanguage.set(detected.language, [...(linesByLanguage.get(detected.language) ?? []), line.trim()]);
    }
    let best: [string, string[]] | undefined;
    for (const entry of linesByLanguage) {
        if (!best || entry[1].length > best[1].length) best = entry;
    }
    return best && { language: best[0], text: best[1].join("\n"), partial: true };
}

/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { readFileSync, existsSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// SettingsStore first: FontWatcher and Settings.tsx import each other, and loading FontWatcher on its own
// hits that cycle from the wrong end (Settings.tsx reading FontWatcher.DEFAULT_DELTA before it's defined).
import "../settings/SettingsStore";
import { FontWatcher } from "../settings/watchers/FontWatcher";
import { GunEmojiStyle } from "../settings/enums/GunEmojiStyle";

// Haven: regression coverage for drawing U+1F52B as a real gun (a handgun or a revolver, the user's
// choice - see the "Haven.gunEmojiStyle" setting) instead of the water pistol the bundled Twemoji
// Mozilla font carries. It's pure static assets + CSS (no code path to unit-test),
// which is exactly why an upstream merge could undo it without a single conflict or test failure:
// res/themes/light/css/_fonts.pcss is an upstream-owned file, and the override only works because
// of where its rules sit in that file. So this checks the assets and the CSS directly.

const RES = fileURLToPath(new URL("../../res/", import.meta.url));
const GUN_FONTS = [
    { style: GunEmojiStyle.Handgun, family: "Haven Handgun", file: `${RES}fonts/Haven/HavenHandgun-colr.woff2` },
    { style: GunEmojiStyle.Revolver, family: "Haven Revolver", file: `${RES}fonts/Haven/HavenRevolver-colr.woff2` },
];
const BUNDLED_FONT = `${RES}fonts/Twemoji_Mozilla/TwemojiMozilla-colr.woff2`;
const FONTS_PCSS = `${RES}themes/light/css/_fonts.pcss`;

const PISTOL = 0x1f52b;

// The WOFF2 spec's known-table-tag list (index -> tag) used by the table directory's flags byte.
const KNOWN_TAGS =
    "cmap head hhea hmtx maxp name OS/2 post cvt fpgm glyf loca prep CFF VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill".split(
        " ",
    );

/** Minimal WOFF2 reader: returns each table's (decompressed, untransformed-length) bytes by tag. */
function readWoff2Tables(file: Buffer): Record<string, Buffer> {
    expect(file.subarray(0, 4).toString("latin1")).toBe("wOF2");
    const numTables = file.readUInt16BE(12);
    const compressedSize = file.readUInt32BE(20);
    let offset = 48;
    const readBase128 = (): number => {
        let value = 0;
        for (let i = 0; i < 5; i++) {
            const byte = file[offset++];
            value = (value * 128 + (byte & 0x7f)) >>> 0;
            if (!(byte & 0x80)) return value;
        }
        throw new Error("bad UIntBase128");
    };
    const directory: { tag: string; length: number }[] = [];
    for (let i = 0; i < numTables; i++) {
        const flags = file[offset++];
        let tag: string;
        if ((flags & 63) === 63) {
            tag = file.subarray(offset, offset + 4).toString("latin1");
            offset += 4;
        } else {
            tag = KNOWN_TAGS[flags & 63];
        }
        const transformVersion = flags >> 6;
        const origLength = readBase128();
        // glyf/loca are "transformed" when version is 0, every other table when it's non-zero.
        const transformed = tag === "glyf" || tag === "loca" ? transformVersion === 0 : transformVersion !== 0;
        directory.push({ tag, length: transformed ? readBase128() : origLength });
    }
    const data = brotliDecompressSync(file.subarray(offset, offset + compressedSize));
    const tables: Record<string, Buffer> = {};
    let position = 0;
    for (const { tag, length } of directory) {
        tables[tag] = data.subarray(position, position + length);
        position += length;
    }
    return tables;
}

/** Glyph id for a codepoint via a format 12 cmap subtable (the only kind that can hold U+1F52B). */
function glyphFor(cmap: Buffer, codepoint: number): number | undefined {
    const subtableCount = cmap.readUInt16BE(2);
    for (let i = 0; i < subtableCount; i++) {
        const start = cmap.readUInt32BE(4 + i * 8 + 4);
        if (cmap.readUInt16BE(start) !== 12) continue;
        const groups = cmap.readUInt32BE(start + 12);
        for (let g = 0; g < groups; g++) {
            const at = start + 16 + g * 12;
            const first = cmap.readUInt32BE(at);
            const last = cmap.readUInt32BE(at + 4);
            if (codepoint >= first && codepoint <= last) return cmap.readUInt32BE(at + 8) + (codepoint - first);
        }
    }
    return undefined;
}

function metricsOf(tables: Record<string, Buffer>): Record<string, number> {
    const hhea = tables["hhea"];
    const os2 = tables["OS/2"];
    const gid = glyphFor(tables["cmap"], PISTOL)!;
    const numberOfHMetrics = hhea.readUInt16BE(34);
    const advance = tables["hmtx"].readUInt16BE(Math.min(gid, numberOfHMetrics - 1) * 4);
    return {
        unitsPerEm: tables["head"].readUInt16BE(18),
        hheaAscent: hhea.readInt16BE(4),
        hheaDescent: hhea.readInt16BE(6),
        hheaLineGap: hhea.readInt16BE(8),
        typoAscender: os2.readInt16BE(68),
        typoDescender: os2.readInt16BE(70),
        typoLineGap: os2.readInt16BE(72),
        winAscent: os2.readUInt16BE(74),
        winDescent: os2.readUInt16BE(76),
        advance,
    };
}

describe.each(GUN_FONTS)("Haven $family font asset", ({ file }) => {
    it("exists and is a COLR color font (not a plain outline font)", () => {
        expect(existsSync(file)).toBe(true);
        const tables = readWoff2Tables(readFileSync(file));
        expect(Object.keys(tables)).toEqual(expect.arrayContaining(["COLR", "CPAL", "cmap", "glyf"]));
    });

    it("covers U+1F52B and nothing else that could shadow ordinary text", () => {
        const { cmap } = readWoff2Tables(readFileSync(file));
        expect(glyphFor(cmap, PISTOL)).toBeDefined();
        expect(glyphFor(cmap, 0x20)).toBeUndefined();
        expect(glyphFor(cmap, 0x1f52a)).toBeUndefined(); // the knife next to it stays the bundled font's
    });

    it("has the same em size, line metrics and advance as the bundled Twemoji font, so it can't change line heights", () => {
        const gun = metricsOf(readWoff2Tables(readFileSync(file)));
        const bundled = metricsOf(readWoff2Tables(readFileSync(BUNDLED_FONT)));
        expect(gun).toEqual(bundled);
    });
});

describe("Haven gun emoji fonts' attribution", () => {
    it("is credited (CC-BY 4.0 requires attribution) next to the assets", () => {
        const readme = readFileSync(`${RES}fonts/Haven/README.txt`, "utf8");
        expect(readme).toContain("CC-BY 4.0");
        expect(readme).toContain("github.com/twitter/twemoji");
    });
});

describe("Haven gun emoji @font-face rules in _fonts.pcss", () => {
    const css = readFileSync(FONTS_PCSS, "utf8");
    const faces = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map((match) => {
        const body = match[1];
        return {
            // Upstream writes the family unquoted (Twemoji), Haven's own faces quoted ("Haven Handgun") - accept both.
            family: body.match(/font-family:\s*"?([^";]+)"?\s*;/)?.[1],
            weight: body.match(/font-weight:\s*(\d+)/)?.[1],
            range: body.match(/unicode-range:\s*([^;]+);/)?.[1].trim(),
            src: body.match(/url\("([^"]+)"\)/)?.[1],
        };
    });

    it("still has the three full-range bundled Twemoji faces", () => {
        const base = faces.filter((face) => face.family === "Twemoji");
        expect(base.map((face) => face.weight)).toEqual(["400", "600", "700"]);
        expect(base.every((face) => face.src === "/res/fonts/Twemoji_Mozilla/TwemojiMozilla-colr.woff2")).toBe(true);
        expect(base.every((face) => !face.range)).toBe(true);
    });

    describe.each(GUN_FONTS)("$family", ({ family, file }) => {
        const own = faces.filter((face) => face.family === family);

        it("is declared for all three weights, limited to U+1F52B", () => {
            expect(own.map((face) => face.weight)).toEqual(["400", "600", "700"]);
            expect(own.every((face) => face.range?.toUpperCase() === "U+1F52B")).toBe(true);
        });

        it("points at its own font file, which exists", () => {
            expect(own.every((face) => face.src === `/res/fonts/Haven/${file.split("/").pop()}`)).toBe(true);
            expect(existsSync(file)).toBe(true);
        });
    });

    it("matches the families FontWatcher puts ahead of Twemoji for each style", () => {
        for (const { style, family } of GUN_FONTS) {
            expect(FontWatcher.GUN_EMOJI_FONTS[style]).toBe(`"${family}"`);
        }
        // Water pistol is Twemoji's own glyph, so it needs no override.
        expect(FontWatcher.GUN_EMOJI_FONTS[GunEmojiStyle.WaterPistol]).toBeUndefined();
    });
});

describe("every theme still pulls in the shared font faces", () => {
    // The override lives in the light theme's _fonts.pcss; the others reuse it by @import. If an
    // upstream merge restructures how themes load fonts, the override silently stops applying.
    it.each([
        ["light", "light/css/light.pcss"],
        ["dark", "dark/css/dark.pcss"],
        ["dark-custom", "dark-custom/css/dark-custom.pcss"],
        ["light-high-contrast", "light-high-contrast/css/light-high-contrast.pcss"],
        ["legacy-light", "legacy-light/css/legacy-light.pcss"],
        ["legacy-dark", "legacy-dark/css/legacy-dark.pcss"],
        ["light-custom", "light-custom/css/light-custom.pcss"],
    ])("%s", (_name, file) => {
        const themes = `${RES}themes/`;
        expect(readFileSync(`${themes}${file}`, "utf8")).toMatch(/_fonts\.pcss/);
    });
});

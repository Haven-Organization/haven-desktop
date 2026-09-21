/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BuildResult } from "electron-builder";

import {
    UPDATE_INFO_SECTION,
    createAppImageUpdateInfoHook,
    embedUpdateInformation,
    githubZsyncUpdateInformation,
    locateSection,
} from "../scripts/appimage-update-info.js";

// Haven: regression coverage for the two AppImage build changes (issues #8 and #9): building with
// electron-builder's static runtime instead of the libfuse2-dependent legacy one, and embedding
// update information + generating a .zsync so AppImageUpdate/AM/AppManager can delta-update it.
// electron-builder.ts is an upstream-owned file, so the config guards at the bottom are what would
// notice an upstream merge quietly dropping those settings.

const SECTION_SIZE = 1024;

/** A minimal little-endian ELF with a `.upd_info` section, laid out like a real AppImage runtime. */
function buildElf(is64: boolean, options: { withUpdInfo?: boolean } = {}): { file: Buffer; sectionOffset: number } {
    const { withUpdInfo = true } = options;
    const headerSize = is64 ? 0x40 : 0x34;
    const entrySize = is64 ? 0x40 : 0x28;
    const sectionOffset = headerSize;
    const contentSize = withUpdInfo ? SECTION_SIZE : 0;
    const names = Buffer.from(`\0.shstrtab\0${UPDATE_INFO_SECTION}\0`, "latin1");
    const namesOffset = sectionOffset + contentSize;
    const tableOffset = namesOffset + names.length;
    const entries = withUpdInfo ? 3 : 2; // null, .shstrtab, [.upd_info]

    const file = Buffer.alloc(tableOffset + entries * entrySize);
    file.writeUInt32BE(0x7f454c46, 0);
    file[4] = is64 ? 2 : 1;
    file[5] = 1; // little endian
    if (is64) {
        file.writeBigUInt64LE(BigInt(tableOffset), 0x28);
        file.writeUInt16LE(entrySize, 0x3a);
        file.writeUInt16LE(entries, 0x3c);
        file.writeUInt16LE(1, 0x3e);
    } else {
        file.writeUInt32LE(tableOffset, 0x20);
        file.writeUInt16LE(entrySize, 0x2e);
        file.writeUInt16LE(entries, 0x30);
        file.writeUInt16LE(1, 0x32);
    }
    names.copy(file, namesOffset);

    const writeEntry = (index: number, name: number, offset: number, size: number): void => {
        const at = tableOffset + index * entrySize;
        file.writeUInt32LE(name, at);
        if (is64) {
            file.writeBigUInt64LE(BigInt(offset), at + 0x18);
            file.writeBigUInt64LE(BigInt(size), at + 0x20);
        } else {
            file.writeUInt32LE(offset, at + 0x10);
            file.writeUInt32LE(size, at + 0x14);
        }
    };
    writeEntry(1, 1, namesOffset, names.length);
    if (withUpdInfo) writeEntry(2, 1 + ".shstrtab".length + 1, sectionOffset, SECTION_SIZE);
    return { file, sectionOffset };
}

/** ELF runtime followed by an arbitrary payload, like the squashfs that follows a real runtime. */
async function writeFakeAppImage(dir: string, name: string, is64 = true): Promise<{ file: string; offset: number; original: Buffer }> {
    const { file: elf, sectionOffset } = buildElf(is64);
    const payload = Buffer.from("SQUASHFS-PAYLOAD".repeat(4096), "latin1");
    const original = Buffer.concat([elf, payload]);
    const file = path.join(dir, name);
    await writeFile(file, original);
    return { file, offset: sectionOffset, original };
}

describe("githubZsyncUpdateInformation", () => {
    it("points at the .zsync asset with the version replaced by a wildcard", () => {
        expect(githubZsyncUpdateInformation("Haven-Organization", "haven-desktop", "Haven-0.8.5.AppImage")).toBe(
            "gh-releases-zsync|Haven-Organization|haven-desktop|latest|Haven-*.AppImage.zsync",
        );
    });

    it("works from a full path and for multi-part product names", () => {
        expect(githubZsyncUpdateInformation("o", "r", "/tmp/out/Some-App-Name-1.2.3-beta.1.AppImage")).toBe(
            "gh-releases-zsync|o|r|latest|Some-App-Name-*.AppImage.zsync",
        );
    });

    it("refuses a file name it can't make a version-independent pattern from", () => {
        expect(() => githubZsyncUpdateInformation("o", "r", "Haven.AppImage")).toThrow();
        expect(() => githubZsyncUpdateInformation("o", "r", "Haven-0.8.5.deb")).toThrow();
    });
});

describe("locateSection", () => {
    it.each([
        ["64-bit", true],
        ["32-bit", false],
    ])("finds .upd_info in a %s ELF", (_label, is64) => {
        const { file, sectionOffset } = buildElf(is64);
        expect(locateSection(file, UPDATE_INFO_SECTION)).toEqual({ offset: sectionOffset, size: SECTION_SIZE });
    });

    it("returns undefined when the section isn't there", () => {
        expect(locateSection(buildElf(true, { withUpdInfo: false }).file, UPDATE_INFO_SECTION)).toBeUndefined();
    });

    it("rejects data that isn't an ELF file", () => {
        expect(() => locateSection(Buffer.alloc(256), UPDATE_INFO_SECTION)).toThrow(/Not an ELF/);
    });
});

describe("embedUpdateInformation", () => {
    let dir: string;
    beforeEach(async () => {
        dir = await mkdtemp(path.join(os.tmpdir(), "haven-appimage-"));
    });
    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it.each([true, false])("writes NUL-padded update info into the section and touches nothing else (64-bit: %s)", async (is64) => {
        const { file, offset, original } = await writeFakeAppImage(dir, "Haven-1.0.0.AppImage", is64);
        const info = "gh-releases-zsync|o|r|latest|Haven-*.AppImage.zsync";

        await embedUpdateInformation(file, info);

        const after = await readFile(file);
        expect(after.length).toBe(original.length);
        expect(after.toString("latin1", offset, offset + info.length)).toBe(info);
        expect(after.subarray(offset + info.length, offset + SECTION_SIZE).every((byte) => byte === 0)).toBe(true);
        // Everything outside the section - the rest of the runtime and the whole payload - is unchanged.
        expect(after.subarray(0, offset).equals(original.subarray(0, offset))).toBe(true);
        expect(after.subarray(offset + SECTION_SIZE).equals(original.subarray(offset + SECTION_SIZE))).toBe(true);
    });

    it("overwrites earlier update info completely rather than leaving a tail of it behind", async () => {
        const { file, offset } = await writeFakeAppImage(dir, "Haven-1.0.0.AppImage");
        await embedUpdateInformation(file, "a-much-longer-first-value-that-must-not-survive|x|y|z");
        await embedUpdateInformation(file, "short");
        const after = await readFile(file);
        expect(after.toString("latin1", offset, offset + 5)).toBe("short");
        expect(after.subarray(offset + 5, offset + SECTION_SIZE).every((byte) => byte === 0)).toBe(true);
    });

    it("refuses update info that won't fit with its terminating NUL", async () => {
        const { file } = await writeFakeAppImage(dir, "Haven-1.0.0.AppImage");
        await expect(embedUpdateInformation(file, "x".repeat(SECTION_SIZE))).rejects.toThrow(/only holds/);
    });

    it("fails clearly when the runtime has no .upd_info section", async () => {
        const file = path.join(dir, "Haven-1.0.0.AppImage");
        await writeFile(file, buildElf(true, { withUpdInfo: false }).file);
        await expect(embedUpdateInformation(file, "x")).rejects.toThrow(/no \.upd_info section/);
    });
});

describe("createAppImageUpdateInfoHook", () => {
    let dir: string;
    let binDir: string;
    const originalPath = process.env.PATH;

    beforeEach(async () => {
        dir = await mkdtemp(path.join(os.tmpdir(), "haven-appimage-hook-"));
        binDir = path.join(dir, "bin");
        await mkdir(binDir);
    });
    afterEach(async () => {
        process.env.PATH = originalPath;
        vi.restoreAllMocks();
        await rm(dir, { recursive: true, force: true });
    });

    const resultFor = (artifactPaths: string[]): BuildResult => ({ outDir: dir, artifactPaths }) as unknown as BuildResult;

    /** A stand-in zsyncmake that records its arguments and creates the requested output file. */
    async function installFakeZsyncmake(): Promise<string> {
        const argsFile = path.join(dir, "zsyncmake-args.txt");
        const script = `#!/bin/sh
printf '%s\\n' "$@" > "${argsFile}"
while [ $# -gt 0 ]; do
  if [ "$1" = "-o" ]; then out="$2"; fi
  shift
done
echo fake-zsync-control-file > "$out"
`;
        await writeFile(path.join(binDir, "zsyncmake"), script);
        await chmod(path.join(binDir, "zsyncmake"), 0o755);
        process.env.PATH = `${binDir}${path.delimiter}${originalPath}`;
        return argsFile;
    }

    it("embeds update info in every AppImage, generates its .zsync, and returns it for publishing", async () => {
        const argsFile = await installFakeZsyncmake();
        const { file, offset } = await writeFakeAppImage(dir, "Haven-1.0.0.AppImage");
        const deb = path.join(dir, "haven-desktop_1.0.0_amd64.deb");
        await writeFile(deb, "not an appimage");

        const extra = await createAppImageUpdateInfoHook("Haven-Organization", "haven-desktop")(resultFor([file, deb]));

        expect(extra).toEqual([`${file}.zsync`]);
        expect(await readFile(`${file}.zsync`, "utf8")).toContain("fake-zsync-control-file");
        expect((await readFile(file)).toString("latin1", offset, offset + 80)).toContain(
            "gh-releases-zsync|Haven-Organization|haven-desktop|latest|Haven-*.AppImage.zsync",
        );
        // The .zsync's URL is the bare file name, so it resolves next to itself on the release page.
        expect((await readFile(argsFile, "utf8")).trim().split("\n")).toEqual([
            "-u",
            "Haven-1.0.0.AppImage",
            "-o",
            `${file}.zsync`,
            file,
        ]);
        expect(await readFile(deb, "utf8")).toBe("not an appimage");
    });

    it("still embeds the update info, warns loudly, and doesn't fail the build when zsyncmake is missing", async () => {
        process.env.PATH = binDir; // an empty directory - no zsyncmake anywhere
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(console, "log").mockImplementation(() => {});
        const { file, offset } = await writeFakeAppImage(dir, "Haven-1.0.0.AppImage");

        const extra = await createAppImageUpdateInfoHook("o", "r")(resultFor([file]));

        expect(extra).toEqual([]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("zsyncmake not found"));
        expect((await readFile(file)).toString("latin1", offset, offset + 6)).toBe("gh-rel");
    });
});

describe("electron-builder.ts (upstream-owned - guards against a merge dropping Haven's AppImage settings)", () => {
    async function loadConfig(): Promise<Record<string, any>> {
        vi.resetModules();
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.stubEnv("VARIANT_PATH", "");
        return (await import("../electron-builder.js")).default as Record<string, any>;
    }
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it("builds AppImages with a static-runtime toolset, not the libfuse2-dependent legacy default", async () => {
        const config = await loadConfig();
        // "0.0.0" (or unset, which means the same) is the legacy runtime that needs libfuse.so.2.
        expect(config.toolsets?.appimage).toBeDefined();
        expect(config.toolsets.appimage).not.toBe("0.0.0");
    });

    it("runs the update-info hook for Haven's own build", async () => {
        expect(typeof (await loadConfig()).afterAllArtifactBuild).toBe("function");
    });

    it("still builds an AppImage target at all", async () => {
        expect((await loadConfig()).linux.target).toContain("AppImage");
    });
});

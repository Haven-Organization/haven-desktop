/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

/*
 * Haven: makes a built AppImage self-describing for delta updates.
 *
 * electron-builder assembles the AppImage itself (a runtime ELF + a squashfs) and only ever appends
 * its own electron-updater blockmap - it never writes AppImage "update information", so tools like
 * AppImageUpdate, AM, AppManager and AppImageLauncher can't tell where a newer version lives or
 * fetch just the changed blocks of it. Both runtimes electron-builder can use reserve a small
 * `.upd_info` ELF section at the very start of the file for exactly this; this fills it in after the
 * build, then generates the matching `.zsync` control file (which has to be published as a release
 * asset next to the AppImage, since the update information only *points* at it).
 *
 * The update information is just a pointer, e.g.
 *     gh-releases-zsync|Haven-Organization|haven-desktop|latest|Haven-*.AppImage.zsync
 * (https://github.com/AppImage/AppImageSpec/blob/master/draft.md#github-releases) - the deltas
 * themselves are worked out on the user's machine from the .zsync file's block checksums.
 *
 * Wired in via `afterAllArtifactBuild` in electron-builder.ts. That hook runs *before* electron-builder
 * writes latest-linux.yml, so the sha512/blockmap recorded there describe the AppImage as it was
 * before these few bytes were filled in. Nothing reads that for Linux (Haven ships no
 * electron-updater), but if that ever changes, the embedding needs to move before the checksum.
 */

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { BuildResult } from "electron-builder";

const execFileAsync = promisify(execFile);

export const UPDATE_INFO_SECTION = ".upd_info";

// The ELF header and section header table sit at the very start of the file, inside the (<1 MB)
// runtime, well before the squashfs payload - no need to read the rest of a ~170 MB file.
const HEADER_SCAN_BYTES = 8 * 1024 * 1024;

/**
 * Update information for an AppImage published to GitHub Releases, in the AppImage spec's
 * `gh-releases-zsync` form. The filename part is a wildcard pattern for the `.zsync` asset name,
 * with the version replaced by `*` so it matches every release, not just this one.
 */
export function githubZsyncUpdateInformation(owner: string, repo: string, appImageFileName: string): string {
    const match = /^(.+?)-v?\d[^/]*\.AppImage$/.exec(path.basename(appImageFileName));
    if (!match) {
        throw new Error(`Can't derive a version-independent update pattern from "${appImageFileName}"`);
    }
    return `gh-releases-zsync|${owner}|${repo}|latest|${match[1]}-*.AppImage.zsync`;
}

/** Where a named section's contents live in the file, from a little-endian ELF32/ELF64 header. */
export function locateSection(elf: Buffer, name: string): { offset: number; size: number } | undefined {
    if (elf.length < 0x40 || elf.readUInt32BE(0) !== 0x7f454c46) {
        throw new Error("Not an ELF file - an AppImage should start with its runtime");
    }
    const is64 = elf[4] === 2;
    if (!is64 && elf[4] !== 1) throw new Error(`Unrecognised ELF class ${elf[4]}`);
    if (elf[5] !== 1) throw new Error("Big-endian ELF files aren't supported");

    const sectionTableOffset = is64 ? Number(elf.readBigUInt64LE(0x28)) : elf.readUInt32LE(0x20);
    const entrySize = elf.readUInt16LE(is64 ? 0x3a : 0x2e);
    const entryCount = elf.readUInt16LE(is64 ? 0x3c : 0x30);
    const nameTableIndex = elf.readUInt16LE(is64 ? 0x3e : 0x32);

    const entry = (index: number): { name: number; offset: number; size: number } => {
        const at = sectionTableOffset + index * entrySize;
        if (at + entrySize > elf.length) {
            throw new Error("ELF section headers lie outside the part of the file that was read");
        }
        return {
            name: elf.readUInt32LE(at),
            offset: is64 ? Number(elf.readBigUInt64LE(at + 0x18)) : elf.readUInt32LE(at + 0x10),
            size: is64 ? Number(elf.readBigUInt64LE(at + 0x20)) : elf.readUInt32LE(at + 0x14),
        };
    };

    const names = entry(nameTableIndex);
    if (names.offset + names.size > elf.length) {
        throw new Error("ELF section name table lies outside the part of the file that was read");
    }
    for (let i = 0; i < entryCount; i++) {
        const section = entry(i);
        const start = names.offset + section.name;
        const end = elf.indexOf(0, start);
        if (end !== -1 && elf.toString("latin1", start, end) === name) {
            return { offset: section.offset, size: section.size };
        }
    }
    return undefined;
}

/** Writes update information into the AppImage's `.upd_info` section, in place. */
export async function embedUpdateInformation(appImagePath: string, updateInformation: string): Promise<void> {
    const handle = await fs.open(appImagePath, "r+");
    try {
        const { size } = await handle.stat();
        const head = Buffer.alloc(Math.min(size, HEADER_SCAN_BYTES));
        await handle.read(head, 0, head.length, 0);

        const section = locateSection(head, UPDATE_INFO_SECTION);
        if (!section) {
            throw new Error(`${path.basename(appImagePath)} has no ${UPDATE_INFO_SECTION} section to write into`);
        }
        const data = Buffer.from(updateInformation, "utf8");
        // Keep room for a terminating NUL - readers treat the section as a C string.
        if (data.length >= section.size) {
            throw new Error(`Update information is ${data.length} bytes, but ${UPDATE_INFO_SECTION} only holds ${section.size - 1}`);
        }
        const padded = Buffer.alloc(section.size);
        data.copy(padded);
        await handle.write(padded, 0, padded.length, section.offset);
    } finally {
        await handle.close();
    }
}

/**
 * Generates `<appImage>.zsync` with `zsyncmake`. The URL inside is the AppImage's bare file name,
 * i.e. relative to wherever the .zsync itself is downloaded from - which, on GitHub Releases, is
 * the same release as the AppImage.
 *
 * Returns undefined (after a loud warning) if zsyncmake isn't installed, rather than failing the
 * whole build: the AppImage is still fine, it just can't be delta-updated until a .zsync exists.
 */
export async function generateZsync(appImagePath: string): Promise<string | undefined> {
    const output = `${appImagePath}.zsync`;
    try {
        await execFileAsync("zsyncmake", ["-u", path.basename(appImagePath), "-o", output, appImagePath], {
            cwd: path.dirname(appImagePath),
        });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            console.warn(
                `\n!! zsyncmake not found - NOT generating ${path.basename(output)}.\n` +
                    `!! The AppImage now advertises delta updates, but with no .zsync asset published next to it\n` +
                    `!! they will fail. Install zsync (Arch: pacman -S zsync, Debian/Ubuntu: apt install zsync)\n` +
                    `!! and re-run, or run: zsyncmake -u ${path.basename(appImagePath)} -o ${path.basename(output)} ${path.basename(appImagePath)}\n`,
            );
            return undefined;
        }
        throw error;
    }
    return output;
}

/**
 * electron-builder `afterAllArtifactBuild` hook: for every AppImage built, embed update information
 * and generate its .zsync. Returns the .zsync files so electron-builder publishes them alongside.
 */
export function createAppImageUpdateInfoHook(owner: string, repo: string): (result: BuildResult) => Promise<string[]> {
    return async (result) => {
        const extraArtifacts: string[] = [];
        for (const artifact of result.artifactPaths.filter((file) => file.endsWith(".AppImage"))) {
            const updateInformation = githubZsyncUpdateInformation(owner, repo, artifact);
            await embedUpdateInformation(artifact, updateInformation);
            console.log(`Embedded AppImage update information in ${path.basename(artifact)}: ${updateInformation}`);
            const zsync = await generateZsync(artifact);
            if (zsync) extraArtifacts.push(zsync);
        }
        return extraArtifacts;
    };
}

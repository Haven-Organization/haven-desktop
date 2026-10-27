#!/usr/bin/env node
/*
 * Packages Ruffle (https://ruffle.rs), the Flash player, into the web build, so Flash games (.swf
 * files) posted in rooms and Social play like webxdc games. Run by setup.sh; opt-in with
 * HAVEN_RUFFLE:
 *
 *   HAVEN_RUFFLE=latest         the latest stable release, from npm (@ruffle-rs/ruffle)
 *   HAVEN_RUFFLE=0.7.1          that release (any version or dist-tag npm has, such as "nightly")
 *   HAVEN_RUFFLE=/path/to/copy  your own copy: a folder with ruffle.js in it, Ruffle's
 *                               "web-selfhosted" .zip, or an npm package .tgz
 *
 * Unset, any copy from an earlier build is removed, so the build has no Flash support.
 *
 * The copy goes in element-web/apps/web/res/ruffle/ (not tracked by git), with ruffle.json listing
 * its version and files. webpack.config.ts builds it in when it's there.
 */

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "element-web", "apps", "web");
const OUT = path.join(WEB, "res", "ruffle");
const REGISTRY = "https://registry.npmjs.org/@ruffle-rs/ruffle";

/** Files of Ruffle's that the build needs: its scripts, its wasm, and its licenses. */
const WANTED = /^(?:[^/]+\.js|[^/]+\.wasm|LICENSE[^/]*)$/;

function fail(message) {
    console.error(`HAVEN_RUFFLE: ${message}`);
    process.exit(1);
}

/** The files of a tar archive, by path. Enough of the format for npm's package tarballs. */
function readTar(buffer) {
    const files = new Map();
    let longName = null;
    for (let at = 0; at + 512 <= buffer.length; ) {
        const header = buffer.subarray(at, at + 512);
        if (header.every((byte) => byte === 0)) break;
        const field = (start, length) => header.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "");
        const size = parseInt(field(124, 12).trim() || "0", 8);
        const type = field(156, 1);
        const prefix = field(345, 155);
        let name = longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
        longName = null;
        const body = buffer.subarray(at + 512, at + 512 + size);
        if (type === "x") {
            // A pax header: the next file's own name may be in it.
            const pax = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString("utf8"));
            if (pax) longName = pax[1];
        } else if (type === "L") {
            longName = body.toString("utf8").replace(/\0.*$/s, "");
        } else if (type === "0" || type === "") {
            files.set(name, Buffer.from(body));
        }
        at += 512 + Math.ceil(size / 512) * 512;
    }
    return files;
}

async function readZip(buffer) {
    // From Haven's own dependencies: setup.sh runs this after pnpm install.
    const require = createRequire(path.join(WEB, "package.json"));
    const JSZip = require("jszip");
    const zip = await JSZip.loadAsync(buffer);
    const files = new Map();
    for (const entry of Object.values(zip.files)) {
        if (!entry.dir) files.set(entry.name, await entry.async("nodebuffer"));
    }
    return files;
}

function readFolder(folder) {
    const files = new Map();
    const walk = (dir, prefix) => {
        for (const name of readdirSync(dir)) {
            const full = path.join(dir, name);
            if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`);
            else files.set(prefix + name, readFileSync(full));
        }
    };
    walk(folder, "");
    return files;
}

/** Ruffle's own files, from wherever ruffle.js is in a copy, with the version it says it is. */
function pickRuffle(files, source) {
    const main = [...files.keys()].filter((name) => /(^|\/)ruffle\.js$/.test(name)).sort((a, b) => a.length - b.length)[0];
    if (!main) fail(`${source} has no ruffle.js in it`);
    const dir = main.slice(0, main.length - "ruffle.js".length);
    const picked = new Map();
    for (const [name, bytes] of files) {
        if (name.startsWith(dir) && WANTED.test(name.slice(dir.length))) picked.set(name.slice(dir.length), bytes);
    }
    if (![...picked.keys()].some((name) => name.endsWith(".wasm"))) fail(`${source} has no Ruffle .wasm files next to ruffle.js`);
    let version = "custom";
    const pkg = files.get(`${dir}package.json`);
    if (pkg) {
        try {
            version = JSON.parse(pkg.toString("utf8")).version || version;
        } catch {
            // Not a package.json worth reading.
        }
    }
    return { picked, version };
}

async function fromNpm(spec) {
    const response = await fetch(`${REGISTRY}/${encodeURIComponent(spec)}`);
    if (!response.ok) fail(`npm has no Ruffle "${spec}" (${response.status} from ${REGISTRY})`);
    const info = await response.json();
    const { tarball, integrity } = info.dist ?? {};
    if (!tarball || !integrity) fail(`npm's details for Ruffle ${info.version} have no tarball or integrity hash`);
    console.log(`==> HAVEN_RUFFLE: downloading Ruffle ${info.version} from npm`);
    const download = await fetch(tarball);
    if (!download.ok) fail(`couldn't download ${tarball} (${download.status})`);
    const bytes = Buffer.from(await download.arrayBuffer());
    // The registry's own hash of the package: what was downloaded is what was published.
    const [algorithm, expected] = integrity.split(/-(.*)/s);
    if (!["sha512", "sha384", "sha256"].includes(algorithm)) fail(`npm gave an integrity hash of a kind this doesn't check (${algorithm})`);
    if (createHash(algorithm).update(bytes).digest("base64") !== expected) {
        fail(`the Ruffle ${info.version} download doesn't match npm's integrity hash`);
    }
    return pickRuffle(readTar(gunzipSync(bytes)), `npm's Ruffle ${info.version}`);
}

async function fromCopy(copy) {
    if (statSync(copy).isDirectory()) return pickRuffle(readFolder(copy), copy);
    const bytes = readFileSync(copy);
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) return pickRuffle(await readZip(bytes), copy);
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) return pickRuffle(readTar(gunzipSync(bytes)), copy);
    fail(`${copy} isn't a folder, a .zip or a .tgz`);
}

async function main() {
    const wanted = (process.env.HAVEN_RUFFLE ?? "").trim();
    rmSync(OUT, { recursive: true, force: true });
    if (!wanted) return;

    let ruffle;
    if (existsSync(wanted)) ruffle = await fromCopy(path.resolve(wanted));
    else if (wanted === "stable") ruffle = await fromNpm("latest");
    else if (/^[A-Za-z0-9][\w.+-]*$/.test(wanted)) ruffle = await fromNpm(wanted);
    else fail(`"${wanted}" isn't "latest", a Ruffle version, or a file or folder that exists`);

    mkdirSync(OUT, { recursive: true });
    for (const [name, bytes] of ruffle.picked) writeFileSync(path.join(OUT, name), bytes);
    const files = [...ruffle.picked.keys()].filter((name) => !name.startsWith("LICENSE")).sort();
    writeFileSync(path.join(OUT, "ruffle.json"), JSON.stringify({ version: ruffle.version, files }, null, 4) + "\n");
    console.log(`==> HAVEN_RUFFLE: Ruffle ${ruffle.version} packaged for Flash games (${files.length} files)`);
}

await main();

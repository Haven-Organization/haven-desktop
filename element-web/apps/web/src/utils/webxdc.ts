/*
 * Haven: webxdc games (https://webxdc.org) shared as files in rooms and Social posts.
 *
 * A game is a zip (.xdc) with an index.html. It runs in a sandbox with an origin of its own, never
 * Haven's (see webxdcSandbox() and res/webxdc-sandbox/): the desktop app serves one at
 * webxdc://<game id>/, the web app uses the site set in haven.webxdc_sandbox_url, and without one, a
 * sandbox bundled with Haven. Either way the game gets its own files and nothing from the internet,
 * as the webxdc spec requires. Flash games run the same way, packaged with Ruffle (see flash.ts).
 *
 * Moves (the spec's "updates") are events of WEBXDC_UPDATE_EVENT_TYPE that reference the game's
 * file event, sent by each player as themselves. A reference keeps them out of threads, so they
 * never show as replies to a post.
 */

import { type MatrixClient, type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { getWebxdcSandboxUrl } from "../../../../../src/apps/framework/config";

export const WEBXDC_MIMETYPES = new Set([
    "application/x-webxdc",
    "application/vnd.webxdc+zip",
    "application/webxdc+zip",
]);
export const WEBXDC_UPDATE_EVENT_TYPE = "software.haven.webxdc.update";

/** Largest update a game may send, leaving room in a 64 KiB event for the rest of it. */
export const WEBXDC_MAX_UPDATE_SIZE = 48_000;
/** Largest game Haven will open. */
export const WEBXDC_MAX_ARCHIVE_SIZE = 100 * 1024 * 1024;

interface FileContent {
    msgtype?: string;
    body?: string;
    filename?: string;
    url?: string;
    file?: { url?: string };
    info?: { mimetype?: string; size?: number };
}

/** Whether a message is a webxdc game file. */
export function isWebxdcFile(content: FileContent | undefined): boolean {
    if (!content || (!content.url && !content.file?.url)) return false;
    if (content.msgtype && content.msgtype !== "m.file") return false;
    const mimetype = content.info?.mimetype?.toLowerCase();
    if (mimetype && WEBXDC_MIMETYPES.has(mimetype)) return true;
    const name = content.filename ?? content.body ?? "";
    return /\.xdc$/i.test(name.trim());
}

export function isWebxdcEvent(event: MatrixEvent): boolean {
    return event.getType() === "m.room.message" && !event.isRedacted() && isWebxdcFile(event.getContent());
}

/** The game's id: the same for everyone, and safe as a hostname. */
export async function webxdcGameId(roomId: string, eventId: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${roomId}|${eventId}`));
    return Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A fresh token for one session of a game. */
export function newWebxdcToken(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Where a game runs. */
export interface WebxdcSandbox {
    /** The sandbox's base URL, ending in "/". */
    base: string;
    /** The page the game's frame opens, before its "#t=...". */
    page: string;
    /** The origin the frame's messages come from: "null" for the bundled sandbox. */
    origin: string;
    /**
     * The bundled sandbox: served with Haven, in a frame with an origin of its own and no service
     * worker (see res/webxdc-sandbox/game/). Some games need more (WebxdcSessionProblem
     * "needs_sandbox"), which haven.webxdc_sandbox_url gives them.
     */
    bundled: boolean;
}

/**
 * Where a game runs. The desktop app has its own sandbox. The web app uses haven.webxdc_sandbox_url, on
 * an origin other than Haven's, when it's configured, and its bundled sandbox otherwise.
 */
export function webxdcSandbox(gameId: string): WebxdcSandbox {
    if (window.electron) {
        const base = `webxdc://${gameId}/`;
        return { base, page: base + "loader.html", origin: `webxdc://${gameId}`, bundled: false };
    }
    const configured = configuredSandbox(gameId);
    if (configured)
        return {
            base: configured,
            page: configured + "loader.html",
            origin: new URL(configured).origin,
            bundled: false,
        };
    const base = new URL("webxdc-sandbox/game/", window.location.href);
    base.search = "";
    base.hash = "";
    return { base: base.href, page: base.href + "index.html", origin: "null", bundled: true };
}

/** haven.webxdc_sandbox_url for this game, or null when it isn't set or can't be used. */
function configuredSandbox(gameId: string): string | null {
    const configured = getWebxdcSandboxUrl();
    if (!configured) return null;
    let url: URL;
    try {
        url = new URL(configured.replaceAll("{id}", gameId), window.location.href);
    } catch {
        logger.warn("webxdc: haven.webxdc_sandbox_url isn't a URL; using the bundled sandbox");
        return null;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    // On Haven's own origin a game could reach the user's session.
    if (url.origin === window.location.origin) {
        logger.warn("webxdc: haven.webxdc_sandbox_url must be on another origin; using the bundled sandbox");
        return null;
    }
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    url.search = "";
    url.hash = "";
    return url.href;
}

export interface WebxdcManifest {
    name?: string;
    sourceCodeUrl?: string;
}

/** The few fields Haven uses from a game's manifest.toml. */
export function parseWebxdcManifest(text: string): WebxdcManifest {
    const manifest: WebxdcManifest = {};
    for (const line of text.split(/\r?\n/)) {
        if (/^\s*\[/.test(line)) break; // only top-level keys
        const match = /^\s*([A-Za-z_]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\s*(?:#.*)?$/.exec(line);
        if (!match) continue;
        const value = match[2] !== undefined ? unescapeTomlString(match[2]) : match[3];
        if (match[1] === "name") manifest.name = value.trim() || undefined;
        if (match[1] === "source_code_url") manifest.sourceCodeUrl = value.trim() || undefined;
    }
    return manifest;
}

function unescapeTomlString(value: string): string {
    return value.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (_, escape: string) => {
        if (escape[0] === "u" || escape[0] === "U") return String.fromCodePoint(parseInt(escape.slice(1), 16));
        return (
            {
                "n": "\n",
                "t": "\t",
                "r": "\r",
                "b": "\b",
                "f": "\f",
                '"': '"',
                "\\": "\\",
            }[escape] ?? escape
        );
    });
}

const MIME_TYPES: Record<string, string> = {
    html: "text/html; charset=utf-8",
    htm: "text/html; charset=utf-8",
    js: "text/javascript; charset=utf-8",
    mjs: "text/javascript; charset=utf-8",
    css: "text/css; charset=utf-8",
    json: "application/json",
    map: "application/json",
    txt: "text/plain; charset=utf-8",
    toml: "text/plain; charset=utf-8",
    xml: "application/xml",
    svg: "image/svg+xml",
    png: "image/png",
    apng: "image/apng",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    ico: "image/x-icon",
    bmp: "image/bmp",
    wasm: "application/wasm",
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    opus: "audio/ogg",
    wav: "audio/wav",
    flac: "audio/flac",
    m4a: "audio/mp4",
    mp4: "video/mp4",
    webm: "video/webm",
    ogv: "video/ogg",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    otf: "font/otf",
    swf: "application/x-shockwave-flash",
};

export function webxdcMimeType(path: string): string {
    const extension = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase();
    return (extension && MIME_TYPES[extension]) || "application/octet-stream";
}

export interface WebxdcArchive {
    /**
     * What the player's saves for this game are kept under: a hash of the file itself, so the same
     * game shares one save wherever it's posted or forwarded.
     */
    saveKey: string;
    manifest: WebxdcManifest;
    /** The game's icon (icon.png or icon.jpg), if it has one. */
    icon?: Blob;
    /** Every file: path, contents, type. */
    files: Array<[string, ArrayBuffer, string]>;
}

export class WebxdcArchiveError extends Error {}

/** Unpack a game. Throws WebxdcArchiveError for a file that isn't a game. */
export async function readWebxdcArchive(blob: Blob): Promise<WebxdcArchive> {
    if (blob.size > WEBXDC_MAX_ARCHIVE_SIZE) throw new WebxdcArchiveError("too large");
    const { default: JSZip } = await import("jszip");
    let zip: InstanceType<typeof JSZip>;
    try {
        zip = await JSZip.loadAsync(blob);
    } catch {
        throw new WebxdcArchiveError("not a zip");
    }

    const entries = Object.values(zip.files).filter((entry) => !entry.dir);
    // Some games are zipped with their folder at the top; open them from inside it.
    let prefix = "";
    if (!zip.file("index.html")) {
        const nested = entries.find((entry) => /^[^/]+\/index\.html$/.test(entry.name));
        if (!nested) throw new WebxdcArchiveError("no index.html");
        prefix = nested.name.slice(0, nested.name.indexOf("/") + 1);
    }

    let total = 0;
    const files: Array<[string, ArrayBuffer, string]> = [];
    for (const entry of entries) {
        if (!entry.name.startsWith(prefix)) continue;
        const path = entry.name.slice(prefix.length);
        if (!path || path.split("/").some((part) => part === ".." || part === ".")) continue;
        const bytes = await entry.async("arraybuffer");
        total += bytes.byteLength;
        if (total > WEBXDC_MAX_ARCHIVE_SIZE * 4) throw new WebxdcArchiveError("too large");
        files.push([path, bytes, webxdcMimeType(path)]);
    }

    const find = (name: string): ArrayBuffer | undefined => files.find(([path]) => path === name)?.[1];
    const manifestBytes = find("manifest.toml");
    const manifest = manifestBytes ? parseWebxdcManifest(new TextDecoder().decode(manifestBytes)) : {};
    const iconName = ["icon.png", "icon.jpg"].find((name) => find(name));
    const icon = iconName ? new Blob([find(iconName)!], { type: webxdcMimeType(iconName) }) : undefined;
    return { saveKey: await webxdcSaveKey(await blob.arrayBuffer()), manifest, icon, files };
}

/** A game's save key: a hash of its file (see WebxdcArchive.saveKey). */
export async function webxdcSaveKey(file: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", file);
    return Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Fetches bytes [start, end) of a file; resolves null when the server won't send just part of it. */
export type WebxdcRangeFetcher = (start: number, end: number) => Promise<ArrayBuffer | null>;

export interface WebxdcCover {
    manifest: WebxdcManifest;
    icon?: Blob;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** The end of a zip: its last record (22 bytes) and the longest comment it can have. */
const ZIP_TAIL = 22 + 0xffff;
/** Largest manifest or icon read for a cover. */
const COVER_FILE_MAX_SIZE = 2 * 1024 * 1024;

interface ZipEntry {
    name: string;
    method: number;
    compressedSize: number;
    localOffset: number;
}

/**
 * Read a big game's name and icon without downloading all of it: just the zip's directory at the
 * end of the file, then the manifest and icon. Returns null when that can't be done this way (the
 * server sends whole files only, or the zip is one this doesn't read).
 */
export async function readWebxdcCover(fetchRange: WebxdcRangeFetcher, size: number): Promise<WebxdcCover | null> {
    const tailStart = Math.max(0, size - ZIP_TAIL);
    const tail = await fetchRange(tailStart, size);
    if (!tail) return null;
    const tailView = new DataView(tail);

    let eocd = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--) {
        if (tailView.getUint32(i, true) === EOCD_SIGNATURE) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) return null;
    const directorySize = tailView.getUint32(eocd + 12, true);
    const directoryOffset = tailView.getUint32(eocd + 16, true);
    if (directoryOffset === 0xffffffff || directoryOffset + directorySize > size) return null; // zip64

    let directory: ArrayBuffer | null;
    if (directoryOffset >= tailStart) {
        directory = tail.slice(directoryOffset - tailStart, directoryOffset - tailStart + directorySize);
    } else {
        directory = await fetchRange(directoryOffset, directoryOffset + directorySize);
    }
    if (!directory) return null;

    const entries = readZipDirectory(directory);
    const find = (names: string[]): ZipEntry | undefined => {
        for (const name of names) {
            const entry =
                entries.find((e) => e.name === name) ?? entries.find((e) => new RegExp(`^[^/]+/${name}$`).test(e.name));
            if (entry) return entry;
        }
        return undefined;
    };

    const read = async (entry: ZipEntry | undefined): Promise<ArrayBuffer | undefined> => {
        if (!entry || entry.compressedSize > COVER_FILE_MAX_SIZE) return undefined;
        // The local header's own name and extra field can differ in length from the directory's, so
        // a little more is fetched than the directory suggests, and more again if that's short.
        const guess = 30 + new TextEncoder().encode(entry.name).length + 512 + entry.compressedSize;
        let chunk = await fetchRange(entry.localOffset, Math.min(size, entry.localOffset + guess));
        if (!chunk || chunk.byteLength < 30) return undefined;
        let view = new DataView(chunk);
        if (view.getUint32(0, true) !== LOCAL_SIGNATURE) return undefined;
        const start = 30 + view.getUint16(26, true) + view.getUint16(28, true);
        if (start + entry.compressedSize > chunk.byteLength) {
            chunk = await fetchRange(
                entry.localOffset,
                Math.min(size, entry.localOffset + start + entry.compressedSize),
            );
            if (!chunk) return undefined;
            view = new DataView(chunk);
        }
        const data = chunk.slice(start, start + entry.compressedSize);
        if (entry.method === 0) return data;
        if (entry.method !== 8) return undefined;
        try {
            const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
            return await new Response(stream).arrayBuffer();
        } catch {
            return undefined;
        }
    };

    const manifestBytes = await read(find(["manifest.toml"]));
    const iconEntry = find(["icon.png", "icon.jpg"]);
    const iconBytes = await read(iconEntry);
    return {
        manifest: manifestBytes ? parseWebxdcManifest(new TextDecoder().decode(manifestBytes)) : {},
        icon: iconBytes && iconEntry ? new Blob([iconBytes], { type: webxdcMimeType(iconEntry.name) }) : undefined,
    };
}

function readZipDirectory(directory: ArrayBuffer): ZipEntry[] {
    const view = new DataView(directory);
    const bytes = new Uint8Array(directory);
    const entries: ZipEntry[] = [];
    let at = 0;
    while (at + 46 <= directory.byteLength && view.getUint32(at, true) === CENTRAL_SIGNATURE) {
        const nameLength = view.getUint16(at + 28, true);
        const extraLength = view.getUint16(at + 30, true);
        const commentLength = view.getUint16(at + 32, true);
        entries.push({
            method: view.getUint16(at + 10, true),
            compressedSize: view.getUint32(at + 20, true),
            localOffset: view.getUint32(at + 42, true),
            name: new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength)),
        });
        at += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}

/*
 * Saves. A game saves the way any web page does, in localStorage. In the sandbox each game gets a
 * localStorage of its own (see the shim in res/webxdc-sandbox/sw.js), filled from the player's save
 * when the game starts and sent back a moment after it changes. The save is kept in the player's
 * account data, so it follows them to other devices; one too big for that goes up as a file.
 */

/** Account data type of a game's save, followed by its save key. */
export const WEBXDC_SAVE_TYPE_PREFIX = "software.haven.webxdc.save.";
/** What a browser gives a page's localStorage. */
export const WEBXDC_MAX_SAVE_SIZE = 5 * 1024 * 1024;
/** Saves up to this size go in the account data itself. */
const INLINE_SAVE_SIZE = 32 * 1024;

export type WebxdcSaveData = Record<string, string>;

interface SaveContent {
    updated?: number;
    data?: unknown;
    url?: string;
}

/** Only string keys and values, as localStorage holds. Null if it's not a save, or too big. */
export function cleanWebxdcSave(data: unknown): WebxdcSaveData | null {
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const out: WebxdcSaveData = {};
    for (const [key, value] of Object.entries(data)) {
        if (typeof value === "string") out[key] = value;
    }
    return new TextEncoder().encode(JSON.stringify(out)).length <= WEBXDC_MAX_SAVE_SIZE ? out : null;
}

export interface WebxdcSave {
    data: WebxdcSaveData;
    /** When it was kept, in ms. */
    updated: number;
}

/** The player's save for a game, or null when there's none. */
export async function loadWebxdcSave(client: MatrixClient, saveKey: string): Promise<WebxdcSave | null> {
    const content = client.getAccountData((WEBXDC_SAVE_TYPE_PREFIX + saveKey) as any)?.getContent<SaveContent>();
    if (!content) return null;
    const updated = typeof content.updated === "number" ? content.updated : 0;
    let data: WebxdcSaveData | null = null;
    if (typeof content.url === "string") {
        const url = client.mxcUrlToHttp(content.url);
        if (!url) return null;
        try {
            const response = await fetch(url);
            if (!response.ok) return null;
            data = cleanWebxdcSave(await response.json());
        } catch {
            return null;
        }
    } else {
        data = cleanWebxdcSave(content.data);
    }
    return data ? { data, updated } : null;
}

/** Keep the player's save for a game. Returns false when it's too big or not a save. */
export async function storeWebxdcSave(client: MatrixClient, saveKey: string, data: unknown): Promise<boolean> {
    const save = cleanWebxdcSave(data);
    if (!save) return false;
    const json = JSON.stringify(save);
    const content: SaveContent = { updated: Date.now() };
    if (new TextEncoder().encode(json).length <= INLINE_SAVE_SIZE) {
        content.data = save;
    } else {
        const upload = await client.uploadContent(new Blob([json], { type: "application/json" }), {
            name: "webxdc-save.json",
            includeFilename: false,
        });
        content.url = upload.content_uri;
    }
    await client.setAccountData((WEBXDC_SAVE_TYPE_PREFIX + saveKey) as any, content as any);
    return true;
}

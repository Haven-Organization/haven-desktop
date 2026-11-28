/*
 * Haven apps framework - a device cache of the files of games in the user's apps, so opening one
 * doesn't download it again (the browser's own cache only keeps media for as long as the server
 * says, a day on Synapse, and can't help with encrypted rooms at all).
 *
 * - Only games in the user's apps are cached, keyed by mxc:// URI (an mxc never changes content).
 * - What's kept is the file exactly as downloaded: in an encrypted room that's the encrypted file,
 *   decrypted again (and checked against the hash in its message) each time it's opened, so
 *   nothing decrypted is stored.
 * - A file over MAX_FILE_BYTES isn't cached. Past MAX_TOTAL_BYTES, the games played longest ago
 *   are dropped first. A game's file goes when the last app using it is removed.
 * - The browser may still clear it when it's short of space; the game is then downloaded again.
 *
 * Records ("meta") are kept apart from the files, so listing and sizing the cache never loads them.
 */

import { type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { type EncryptedFile, type MediaEventContent } from "matrix-js-sdk/src/types";
import { logger } from "matrix-js-sdk/src/logger";
import encrypt from "matrix-encrypt-attachment";

import { mediaFromContent } from "../../../../element-web/apps/web/src/customisations/Media";
import { getBlobSafeMimeType } from "../../../../element-web/apps/web/src/utils/blobs";
import { queryUploadedMediaCache } from "../../../../element-web/apps/web/src/utils/UploadedMediaCache";

export const MAX_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 256 * 1024 * 1024;

const DB_NAME = "haven-game-files";
const FILES = "files";
const META = "meta";

/** What's known about one cached file. */
export interface CachedFileMeta {
    mxc: string;
    size: number;
    /** When a game using it was last opened (ms since the epoch). */
    lastUsed: number;
    /** The game apps (gameAppId) using it. */
    appIds: string[];
}

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
    dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = (): void => {
            req.result.createObjectStore(FILES);
            req.result.createObjectStore(META, { keyPath: "mxc" });
        };
        req.onsuccess = (): void => resolve(req.result);
        req.onerror = (): void => reject(req.error);
    }).catch((e) => {
        dbPromise = undefined; // Try again next time.
        throw e;
    });
    return dbPromise;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = (): void => resolve(req.result);
        req.onerror = (): void => reject(req.error);
    });
}

function done(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = (): void => resolve();
        tx.onerror = (): void => reject(tx.error);
        tx.onabort = (): void => reject(tx.error);
    });
}

/** Every cached file's record. */
export async function listCachedFiles(): Promise<CachedFileMeta[]> {
    const db = await openDb();
    return request(db.transaction(META).objectStore(META).getAll() as IDBRequest<CachedFileMeta[]>);
}

/** The cache's total size in bytes. */
export async function cachedBytes(): Promise<number> {
    return (await listCachedFiles()).reduce((sum, meta) => sum + meta.size, 0);
}

/** A cached file, noting that `appId` used it just now, or undefined when it isn't cached. */
async function readCached(mxc: string, appId: string): Promise<ArrayBuffer | undefined> {
    const db = await openDb();
    const tx = db.transaction([FILES, META], "readwrite");
    const [bytes, meta] = (await Promise.all([
        request(tx.objectStore(FILES).get(mxc)),
        request(tx.objectStore(META).get(mxc)),
    ])) as [ArrayBuffer | undefined, CachedFileMeta | undefined];
    if (bytes && meta) {
        tx.objectStore(META).put({
            ...meta,
            lastUsed: Date.now(),
            appIds: meta.appIds.includes(appId) ? meta.appIds : [...meta.appIds, appId],
        });
    }
    await done(tx);
    return bytes && meta ? bytes : undefined;
}

async function deleteFiles(db: IDBDatabase, mxcs: string[]): Promise<void> {
    if (!mxcs.length) return;
    const tx = db.transaction([FILES, META], "readwrite");
    for (const mxc of mxcs) {
        tx.objectStore(FILES).delete(mxc);
        tx.objectStore(META).delete(mxc);
    }
    await done(tx);
}

/** The files to drop so the cache fits in `limit` bytes: the ones used longest ago first. */
export function filesToEvict(metas: CachedFileMeta[], limit: number): string[] {
    let total = metas.reduce((sum, meta) => sum + meta.size, 0);
    const evict: string[] = [];
    for (const meta of [...metas].sort((a, b) => a.lastUsed - b.lastUsed)) {
        if (total <= limit) break;
        evict.push(meta.mxc);
        total -= meta.size;
    }
    return evict;
}

async function writeCached(mxc: string, bytes: ArrayBuffer, appId: string): Promise<void> {
    if (bytes.byteLength > MAX_FILE_BYTES) return;
    const db = await openDb();
    // Room for it first, so the cache never goes over its limit.
    await deleteFiles(db, filesToEvict(await listCachedFiles(), MAX_TOTAL_BYTES - bytes.byteLength));
    const tx = db.transaction([FILES, META], "readwrite");
    tx.objectStore(FILES).put(bytes, mxc);
    tx.objectStore(META).put({ mxc, size: bytes.byteLength, lastUsed: Date.now(), appIds: [appId] });
    await done(tx);
}

/** Drops game apps from the cache, deleting files no other app uses. */
export async function forgetGameApps(appIds: string[]): Promise<void> {
    const db = await openDb();
    const unused: string[] = [];
    const tx = db.transaction(META, "readwrite");
    for (const meta of (await request(tx.objectStore(META).getAll())) as CachedFileMeta[]) {
        const rest = meta.appIds.filter((id) => !appIds.includes(id));
        if (rest.length === meta.appIds.length) continue;
        if (rest.length) tx.objectStore(META).put({ ...meta, appIds: rest });
        else unused.push(meta.mxc);
    }
    await done(tx);
    await deleteFiles(db, unused);
}

/** Drops files no longer used by any of the user's game apps (e.g. removed on another device). */
export async function pruneGameFileCache(currentAppIds: string[]): Promise<void> {
    const gone = new Set<string>();
    for (const meta of await listCachedFiles()) {
        for (const id of meta.appIds) if (!currentAppIds.includes(id)) gone.add(id);
    }
    if (gone.size) await forgetGameApps([...gone]);
}

/** Empties the cache. */
export async function clearGameFileCache(): Promise<void> {
    const db = await openDb();
    const tx = db.transaction([FILES, META], "readwrite");
    tx.objectStore(FILES).clear();
    tx.objectStore(META).clear();
    await done(tx);
}

/** The file as downloaded (still encrypted, in an encrypted room) into the usable file. */
async function toBlob(bytes: ArrayBuffer, content: MediaEventContent): Promise<Blob> {
    const mimetype = getBlobSafeMimeType(content.info?.mimetype?.split(";")[0].trim() ?? "");
    const file = (content as { file?: EncryptedFile }).file;
    // decryptAttachment also checks the file against the hash in its message.
    const data = file ? await encrypt.decryptAttachment(bytes, file) : bytes;
    return new Blob([data], { type: mimetype });
}

/**
 * The game file in `event`, for the game app `appId`: from the cache when it's there, else
 * downloaded and cached. Falls back to `download` (the stock download) for a file uploaded this
 * session, or if the cache can't be used at all.
 */
export async function getCachedGameFile(
    event: MatrixEvent,
    appId: string,
    download: () => Promise<Blob>,
): Promise<Blob> {
    const content = event.getContent<MediaEventContent>();
    const media = mediaFromContent(content);
    const mxc = media.srcMxc;
    if (!mxc || queryUploadedMediaCache(mxc)) return download();

    let cached: ArrayBuffer | undefined;
    try {
        cached = await readCached(mxc, appId);
    } catch (e) {
        logger.warn("Couldn't read the game file cache", e);
        return download();
    }
    if (cached) {
        try {
            return await toBlob(cached, content);
        } catch (e) {
            // A damaged copy: download it again, replacing it.
            logger.warn("A cached game file couldn't be used", e);
        }
    }

    const response = await media.downloadSource();
    if (!response.ok) return download(); // Its error handling and messages.
    const bytes = await response.arrayBuffer();
    const blob = await toBlob(bytes, content);
    // Only once it has opened, so a file that doesn't decrypt isn't kept.
    writeCached(mxc, bytes, appId).catch((e) => logger.warn("Couldn't cache a game file", e));
    return blob;
}

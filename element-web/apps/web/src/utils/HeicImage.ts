/*
 * Haven: showing HEIC/HEIF pictures (what an iPhone's camera saves by default).
 *
 * Chromium and Firefox cannot draw this format, and a homeserver typically cannot make a thumbnail
 * of it either, so such a picture downloaded fine and then showed "Unable to show image due to
 * error" forever. The file is converted to a JPEG in a worker instead (workers/heic.worker.ts) and
 * that is what gets displayed. Downloading the picture still gives the original file.
 */

import { WorkerManager } from "../WorkerManager";
import heicWorkerFactory from "../workers/heicWorkerFactory";
import { type Request, type Response } from "../workers/heic.worker";

const HEIC_MIME_TYPES = ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"];

/**
 * How many converted pictures are kept. A timeline tile is recreated whenever it scrolls back
 * into view, and without this each time would convert the same picture again.
 */
const MAX_CACHED_PICTURES = 40;

/** Converted pictures by cache key, oldest first. */
const cache = new Map<string, Promise<string>>();

let worker: WorkerManager<Request, Response> | undefined;

/**
 * Whether a picture with this MIME type has to be converted before it can be shown.
 */
export function isHeicMimeType(mimeType?: string): boolean {
    return !!mimeType && HEIC_MIME_TYPES.includes(mimeType.toLowerCase());
}

async function convert(getBlob: () => Promise<Blob>): Promise<string> {
    const data = await (await getBlob()).arrayBuffer();
    // Created on first use, so the decoder is only ever downloaded by someone who meets a HEIC picture.
    worker ??= new WorkerManager<Request, Response>(heicWorkerFactory());
    const { jpeg, error } = await worker.call({ data });
    if (!jpeg) {
        throw new Error(`Unable to convert HEIC image: ${error ?? "unknown error"}`);
    }
    return URL.createObjectURL(jpeg);
}

/**
 * Gives an object URL of a HEIC picture converted to JPEG. The URL stays owned by this module:
 * callers must not revoke it.
 * @param key - identifies the picture (its mxc URL), so it is only converted once.
 * @param getBlob - fetches the original HEIC file, decrypted if it was encrypted.
 */
export function getHeicDisplayUrl(key: string, getBlob: () => Promise<Blob>): Promise<string> {
    const cached = cache.get(key);
    if (cached) {
        // Counts as the newest again.
        cache.delete(key);
        cache.set(key, cached);
        return cached;
    }

    const converted = convert(getBlob);
    cache.set(key, converted);
    // A failure is not kept, so that trying again actually tries again.
    converted.catch(() => {
        if (cache.get(key) === converted) cache.delete(key);
    });

    while (cache.size > MAX_CACHED_PICTURES) {
        const [oldestKey, oldest] = cache.entries().next().value!;
        cache.delete(oldestKey);
        oldest.then(
            (url) => URL.revokeObjectURL(url),
            () => {},
        );
    }

    return converted;
}

/** For tests: forgets every converted picture and the worker. */
export function resetHeicImagesForTest(): void {
    cache.clear();
    worker = undefined;
}

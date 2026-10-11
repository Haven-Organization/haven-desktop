/*
 * Haven: turns a HEIC/HEIF picture into a JPEG, off the main thread - decoding a phone-sized photo
 * takes long enough to freeze the app if done there. See utils/HeicImage.ts for why this exists.
 */

import libheif from "libheif-js/wasm-bundle";

import { type WorkerPayload } from "./worker";

const ctx: Worker = self as any;

export interface Request {
    /** The HEIC file's bytes. */
    data: ArrayBuffer;
}

export interface Response {
    /** The picture as a JPEG. Missing when it could not be converted. */
    jpeg?: Blob;
    /** Why the picture could not be converted. */
    error?: string;
}

const JPEG_QUALITY = 0.9;

async function convert(data: ArrayBuffer): Promise<Blob> {
    const images = new libheif.HeifDecoder().decode(new Uint8Array(data));
    if (images.length === 0) {
        throw new Error("Not a HEIF image");
    }

    // A HEIF file can hold several pictures (a burst, or a photo plus its depth map). The first is
    // the one meant to be shown.
    const [image, ...others] = images;
    others.forEach((other) => other.free());

    try {
        const width = image.get_width();
        const height = image.get_height();
        const pixels = await new Promise<Uint8ClampedArray>((resolve, reject) => {
            image.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, (result) => {
                if (result) resolve(result.data);
                else reject(new Error("HEIF decoding failed"));
            });
        });

        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext("2d");
        if (!context) {
            throw new Error("No 2d canvas available");
        }
        // Copied into a fresh array: ImageData wants one backed by a plain ArrayBuffer, and the
        // decoder's own type does not promise that.
        context.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
        return await canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
    } finally {
        image.free();
    }
}

ctx.addEventListener("message", (event: MessageEvent<Request & WorkerPayload>): void => {
    const { seq, data } = event.data;
    convert(data).then(
        (jpeg) => ctx.postMessage({ seq, jpeg }),
        (error) => ctx.postMessage({ seq, error: error instanceof Error ? error.message : String(error) }),
    );
});

/*
 * Haven: types for the part of libheif-js that the HEIC worker uses (the package's "wasm-bundle"
 * entry point ships no types of its own).
 */

declare module "libheif-js/wasm-bundle" {
    interface HeifDisplayData {
        data: Uint8ClampedArray;
        width: number;
        height: number;
    }

    interface HeifImage {
        get_width(): number;
        get_height(): number;
        /** Writes the picture into `target` as RGBA. Calls back with null when decoding fails. */
        display(target: HeifDisplayData, callback: (result: HeifDisplayData | null) => void): void;
        free(): void;
    }

    class HeifDecoder {
        /** The pictures in the file. Empty when the data is not a HEIF file. */
        public decode(data: Uint8Array): HeifImage[];
    }

    const libheif: { HeifDecoder: typeof HeifDecoder };
    export default libheif;
}

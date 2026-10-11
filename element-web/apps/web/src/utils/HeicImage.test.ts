/*
 * Haven: tests for HeicImage.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getHeicDisplayUrl, isHeicMimeType, resetHeicImagesForTest } from "./HeicImage";

const call = vi.fn();

vi.mock("../workers/heicWorkerFactory", () => ({ default: vi.fn(() => ({})) }));
vi.mock("../WorkerManager", () => ({
    WorkerManager: class {
        public call = call;
    },
}));

describe("HeicImage", () => {
    const heic = (): Promise<Blob> => Promise.resolve(new Blob(["heic"], { type: "image/heic" }));
    let urlCount: number;

    beforeEach(() => {
        urlCount = 0;
        call.mockReset().mockImplementation(async () => ({ jpeg: new Blob(["jpeg"], { type: "image/jpeg" }) }));
        vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:converted-${++urlCount}`);
        vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    });

    afterEach(() => {
        resetHeicImagesForTest();
        vi.restoreAllMocks();
    });

    it.each(["image/heic", "image/heif", "IMAGE/HEIC", "image/heic-sequence"])("treats %s as HEIC", (type) => {
        expect(isHeicMimeType(type)).toBe(true);
    });

    it.each(["image/jpeg", "image/avif", "", undefined])("does not treat %s as HEIC", (type) => {
        expect(isHeicMimeType(type)).toBe(false);
    });

    it("converts the picture in the worker and returns a URL for the result", async () => {
        await expect(getHeicDisplayUrl("mxc://server/a", heic)).resolves.toBe("blob:converted-1");

        expect(call).toHaveBeenCalledWith({ data: expect.any(ArrayBuffer) });
    });

    it("converts each picture only once", async () => {
        const getBlob = vi.fn(heic);

        const first = await getHeicDisplayUrl("mxc://server/a", getBlob);
        const second = await getHeicDisplayUrl("mxc://server/a", getBlob);

        expect(second).toBe(first);
        expect(getBlob).toHaveBeenCalledTimes(1);
        expect(call).toHaveBeenCalledTimes(1);
    });

    it("fails when the worker cannot convert the picture, and tries again next time", async () => {
        call.mockResolvedValueOnce({ error: "Not a HEIF image" });

        await expect(getHeicDisplayUrl("mxc://server/a", heic)).rejects.toThrow("Not a HEIF image");
        await expect(getHeicDisplayUrl("mxc://server/a", heic)).resolves.toBe("blob:converted-1");
    });

    it("fails when the picture cannot be downloaded, and tries again next time", async () => {
        await expect(getHeicDisplayUrl("mxc://server/a", () => Promise.reject(new Error("offline")))).rejects.toThrow(
            "offline",
        );
        await expect(getHeicDisplayUrl("mxc://server/a", heic)).resolves.toBe("blob:converted-1");
    });

    it("lets go of the oldest pictures beyond the limit", async () => {
        for (let i = 1; i <= 41; i++) {
            await getHeicDisplayUrl(`mxc://server/${i}`, heic);
        }
        await Promise.resolve();

        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:converted-1");
    });

    it("keeps a picture that was used again recently", async () => {
        for (let i = 1; i <= 40; i++) {
            await getHeicDisplayUrl(`mxc://server/${i}`, heic);
        }
        await getHeicDisplayUrl("mxc://server/1", heic);
        await getHeicDisplayUrl("mxc://server/41", heic);
        await Promise.resolve();

        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:converted-2");
        expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:converted-1");
    });
});

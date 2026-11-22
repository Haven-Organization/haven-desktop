/*
 * Haven apps framework - the small copy of a game's icon kept with its link (gameApps.ts).
 *
 * Account data is meant for small things, so the icon is redrawn at most ICON_SIZE pixels across,
 * as a PNG data: URL. Pixel art (a small icon) stays sharp; anything bigger is smoothed.
 */

const ICON_SIZE = 96;
/** Past this, a busy icon is tried again smaller, then left out. */
const MAX_DATA_URL_LENGTH = 48 * 1024;
const PIXEL_ART_MAX = 64;

function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Couldn't load the game's icon"));
        image.src = url;
    });
}

function draw(image: HTMLImageElement, size: number): string | undefined {
    const scale = Math.min(1, size / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    context.imageSmoothingEnabled = Math.max(image.naturalWidth, image.naturalHeight) > PIXEL_ART_MAX;
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/png");
}

/** A small data: URL copy of the icon at `url`, or undefined when it can't be made small enough. */
export async function shrinkGameIcon(url: string): Promise<string | undefined> {
    try {
        const image = await loadImage(url);
        if (!image.naturalWidth || !image.naturalHeight) return undefined;
        for (const size of [ICON_SIZE, ICON_SIZE / 2]) {
            const dataUrl = draw(image, size);
            if (dataUrl && dataUrl.length <= MAX_DATA_URL_LENGTH) return dataUrl;
        }
    } catch {
        // No icon, then: the app shows a generic one.
    }
    return undefined;
}

/*
 * Haven: Flash games (.swf files) shared in rooms and Social posts, played with Ruffle
 * (https://ruffle.rs), when the build has it (HAVEN_RUFFLE, see scripts/fetch-ruffle.mjs).
 *
 * A Flash game plays like a webxdc game, in the same sandbox, with the same card, saves and pop-out:
 * it's packaged as one here, from the movie, Ruffle's files (served with Haven, under ruffle/), and
 * a page that starts Ruffle on the movie. Ruffle keeps a game's saves (Flash "shared objects") in
 * localStorage, which the sandbox keeps as the player's save.
 */

import { isWebxdcFile, type WebxdcArchive, WebxdcArchiveError, WEBXDC_MAX_ARCHIVE_SIZE, webxdcSaveKey } from "./webxdc";

type FileContent = Parameters<typeof isWebxdcFile>[0];

export const FLASH_MIMETYPES = new Set(["application/x-shockwave-flash", "application/vnd.adobe.flash.movie"]);

/** The movie's name in its package. Fixed, as Ruffle names the game's saves after it. */
const MOVIE = "movie.swf";

/** The version of Ruffle this build has, or "" when it has none. */
export function ruffleVersion(): string {
    return process.env.HAVEN_RUFFLE || "";
}

/** Whether a message is a Flash movie. */
export function isFlashFile(content: FileContent): boolean {
    if (!content || (!content.url && !content.file?.url)) return false;
    if (content.msgtype && content.msgtype !== "m.file") return false;
    const mimetype = content.info?.mimetype?.toLowerCase();
    if (mimetype && FLASH_MIMETYPES.has(mimetype)) return true;
    const name = content.filename ?? content.body ?? "";
    return /\.swf$/i.test(name.trim());
}

/** Whether a message is a game Haven can play here: a webxdc game, or Flash when the build has Ruffle. */
export function isGameFile(content: FileContent): boolean {
    return isWebxdcFile(content) || (!!ruffleVersion() && isFlashFile(content));
}

let ruffleFiles: Promise<WebxdcArchive["files"]> | undefined;

/** Ruffle's files, fetched from Haven's own build once a Flash game is first played. */
function loadRuffle(): Promise<WebxdcArchive["files"]> {
    ruffleFiles ??= (async () => {
        const base = new URL("ruffle/", window.location.href);
        const response = await fetch(new URL("ruffle.json", base));
        if (!response.ok) throw new Error(`no Ruffle in this build (${response.status})`);
        const { files } = (await response.json()) as { files: string[] };
        return Promise.all(
            files.map(async (name): Promise<[string, ArrayBuffer, string]> => {
                const file = await fetch(new URL(name, base));
                if (!file.ok) throw new Error(`Ruffle's ${name} is missing (${file.status})`);
                const type = name.endsWith(".wasm") ? "application/wasm" : "text/javascript";
                return [name, await file.arrayBuffer(), type];
            }),
        );
    })();
    // A failure is tried again next time.
    ruffleFiles.catch(() => (ruffleFiles = undefined));
    return ruffleFiles;
}

/** Thrown when Ruffle itself couldn't be loaded, as opposed to the movie being no good. */
export class FlashPlayerError extends Error {}

/** The page that plays the movie: Ruffle, with no way out to the internet. */
function playerPage(title: string): string {
    const config = {
        publicPath: "./",
        polyfills: false,
        autoplay: "on",
        unmuteOverlay: "hidden",
        splashScreen: false,
        letterbox: "on",
        allowNetworking: "none",
        openUrlMode: "deny",
        allowScriptAccess: false,
        warnOnUnsupportedContent: false,
        showSwfDownload: false,
        contextMenu: "rightClickOnly",
        logLevel: "warn",
    };
    const escaped = title.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escaped}</title>
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  #player, #player > * { width: 100%; height: 100%; display: block; }
</style>
</head>
<body>
<div id="player"></div>
<script>window.RufflePlayer = { config: ${JSON.stringify(config)} };</script>
<script src="ruffle.js"></script>
<script>
  window.addEventListener("load", function () {
    var player = window.RufflePlayer.newest().createPlayer();
    document.getElementById("player").appendChild(player);
    (player.ruffle ? player.ruffle() : player).load({ url: ${JSON.stringify(MOVIE)} });
  });
</script>
</body>
</html>
`;
}

/**
 * Package a Flash movie with Ruffle, to play like a webxdc game. Throws WebxdcArchiveError for a
 * file that isn't a Flash movie, and FlashPlayerError when Ruffle couldn't be loaded.
 */
export async function readFlashArchive(blob: Blob, name: string): Promise<WebxdcArchive> {
    if (blob.size > WEBXDC_MAX_ARCHIVE_SIZE) throw new WebxdcArchiveError("too large");
    const movie = await blob.arrayBuffer();
    // "FWS", "CWS" or "ZWS": uncompressed, zlib or LZMA.
    const signature = new TextDecoder().decode(new Uint8Array(movie, 0, Math.min(3, movie.byteLength)));
    if (!["FWS", "CWS", "ZWS"].includes(signature)) throw new WebxdcArchiveError("not a Flash movie");

    let ruffle: WebxdcArchive["files"];
    try {
        ruffle = await loadRuffle();
    } catch (e) {
        throw new FlashPlayerError(e instanceof Error ? e.message : String(e));
    }
    return {
        saveKey: await webxdcSaveKey(movie),
        manifest: { name },
        files: [
            ["index.html", new TextEncoder().encode(playerPage(name)).buffer, "text/html"],
            ...ruffle,
            [MOVIE, movie, "application/x-shockwave-flash"],
        ],
    };
}

/*
 * Haven: rich embeds for links.
 *
 * Works out whether a link can be shown inline as a player or media (a YouTube video, a Twitch
 * stream, video or clip, an X post, or a direct image or video file), and how. The RichEmbed
 * component decides when to show it.
 */

import { type IPreviewUrlResponse } from "matrix-js-sdk/src/matrix";

export type RichEmbedKind = "youtube" | "twitch" | "x" | "image" | "video";

export interface RichEmbedTarget {
    kind: RichEmbedKind;
    /** Key for the "always embed" choice: the service's main domain, or the host of a direct media link. */
    siteKey: string;
    /** Name shown in the "always embed" checkbox. */
    siteLabel: string;
    /** The iframe's src (YouTube, Twitch, X) or the media's own URL (image, video). */
    src: string;
    /** Width / height of the player, for the iframe kinds that have a fixed shape. */
    aspectRatio?: number;
    /** Thumbnail to show on the click-to-play cover, when the link itself gives one. */
    thumbnail?: string;
}

const YOUTUBE_HOSTS = new Set([
    "youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtube-nocookie.com",
    "youtu.be",
]);
const TWITCH_HOSTS = new Set(["twitch.tv", "m.twitch.tv", "go.twitch.tv"]);
const X_HOSTS = new Set([
    "x.com",
    "twitter.com",
    "mobile.twitter.com",
    "mobile.x.com",
    "fxtwitter.com",
    "vxtwitter.com",
    "fixupx.com",
    "fixvx.com",
]);

/** First path segments on twitch.tv that are site pages rather than channels. */
const TWITCH_RESERVED_PATHS = new Set([
    "directory",
    "downloads",
    "drops",
    "friends",
    "inventory",
    "jobs",
    "login",
    "messages",
    "p",
    "payments",
    "prime",
    "search",
    "settings",
    "signup",
    "subscriptions",
    "turbo",
    "wallet",
    "store",
    "products",
]);

const IMAGE_EXTENSIONS = /\.(?:jpe?g|png|gif|webp|avif|apng|bmp|svg)$/i;
const VIDEO_EXTENSIONS = /\.(?:mp4|m4v|webm|mov|ogv)$/i;

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** Hostname without a leading "www.", lowercased. */
function bareHost(url: URL): string {
    return url.hostname.toLowerCase().replace(/^www\./, "");
}

/**
 * Parse a YouTube or Twitch style time ("90", "90s", "1m30s", "1h2m3s") into seconds.
 * Returns undefined for anything else.
 */
export function parseTimeOffset(value: string | null): number | undefined {
    if (!value) return undefined;
    if (/^\d+$/.test(value)) return Number(value);
    const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i.exec(value);
    if (!match || (!match[1] && !match[2] && !match[3])) return undefined;
    return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

function youTubeTarget(url: URL, host: string): RichEmbedTarget | null {
    const segments = url.pathname.split("/").filter(Boolean);
    let id: string | undefined;
    let aspectRatio = 16 / 9;
    if (host === "youtu.be") {
        id = segments[0];
    } else if (segments[0] === "watch") {
        id = url.searchParams.get("v") ?? undefined;
    } else if (segments[0] === "shorts") {
        id = segments[1];
        aspectRatio = 9 / 16;
    } else if (segments[0] === "live" || segments[0] === "embed" || segments[0] === "v") {
        id = segments[1];
    }
    if (!id || !YOUTUBE_ID.test(id)) return null;

    const params = new URLSearchParams();
    const start = parseTimeOffset(url.searchParams.get("t") ?? url.searchParams.get("start"));
    if (start) params.set("start", String(start));
    const list = url.searchParams.get("list");
    if (list && /^[A-Za-z0-9_-]+$/.test(list)) params.set("list", list);
    const query = params.toString();

    return {
        kind: "youtube",
        siteKey: "youtube.com",
        siteLabel: "YouTube",
        src: `https://www.youtube-nocookie.com/embed/${id}${query ? `?${query}` : ""}`,
        aspectRatio,
        thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    };
}

function twitchTarget(url: URL, host: string, parentHost: string): RichEmbedTarget | null {
    const segments = url.pathname.split("/").filter(Boolean);
    const parent = encodeURIComponent(parentHost);
    const base = { kind: "twitch" as const, siteKey: "twitch.tv", siteLabel: "Twitch", aspectRatio: 16 / 9 };

    if (host === "clips.twitch.tv") {
        const slug = segments[0];
        if (!slug || slug === "embed" || !/^[\w-]+$/.test(slug)) return null;
        return { ...base, src: `https://clips.twitch.tv/embed?clip=${encodeURIComponent(slug)}&parent=${parent}` };
    }
    if (!segments.length) return null;

    if (segments[0] === "videos" && segments[1] && /^\d+$/.test(segments[1])) {
        const time = url.searchParams.get("t");
        const timeParam = time && parseTimeOffset(time) !== undefined ? `&time=${encodeURIComponent(time)}` : "";
        return { ...base, src: `https://player.twitch.tv/?video=v${segments[1]}&parent=${parent}${timeParam}` };
    }

    const channel = segments[0].toLowerCase();
    if (TWITCH_RESERVED_PATHS.has(channel) || !/^\w{2,25}$/.test(channel)) return null;
    if (segments[1] === "clip" && segments[2] && /^[\w-]+$/.test(segments[2])) {
        return { ...base, src: `https://clips.twitch.tv/embed?clip=${encodeURIComponent(segments[2])}&parent=${parent}` };
    }
    // Other channel subpages (about, schedule, videos list) aren't a player.
    if (segments.length > 1) return null;
    return { ...base, src: `https://player.twitch.tv/?channel=${channel}&parent=${parent}` };
}

function xTarget(url: URL, dark: boolean): RichEmbedTarget | null {
    // /<user>/status/<id>, /i/status/<id>, and the same with /photo/1 or /video/1 after it.
    const match = /^\/(?:[\w]{1,15}|i(?:\/web)?)\/status(?:es)?\/(\d{1,25})(?:\/|$)/.exec(url.pathname);
    if (!match) return null;
    return {
        kind: "x",
        siteKey: "x.com",
        siteLabel: "X",
        src: `https://platform.twitter.com/embed/Tweet.html?id=${match[1]}&dnt=true&theme=${dark ? "dark" : "light"}`,
    };
}

function directMediaTarget(url: URL, host: string): RichEmbedTarget | null {
    const path = url.pathname;
    // imgur's .gifv pages are an mp4 behind a page.
    if (host === "i.imgur.com" && /\.gifv$/i.test(path)) {
        const mp4 = new URL(url.toString());
        mp4.pathname = path.replace(/\.gifv$/i, ".mp4");
        return { kind: "video", siteKey: host, siteLabel: host, src: mp4.toString() };
    }
    if (IMAGE_EXTENSIONS.test(path)) return { kind: "image", siteKey: host, siteLabel: host, src: url.toString() };
    if (VIDEO_EXTENSIONS.test(path)) return { kind: "video", siteKey: host, siteLabel: host, src: url.toString() };
    return null;
}

export interface RichEmbedOptions {
    /** Hostname of the page the embed is shown in, which Twitch requires. */
    parentHost: string;
    /** Whether the app is showing a dark theme, for the X post embed. */
    dark: boolean;
}

/**
 * Work out how to embed a link, or null when it isn't a link Haven can embed.
 *
 * @param link The link from the message.
 * @param options Details of the page the embed is shown in.
 */
export function getRichEmbedTarget(link: string, options: RichEmbedOptions): RichEmbedTarget | null {
    if (!URL.canParse(link)) return null;
    const url = new URL(link);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = bareHost(url);

    if (YOUTUBE_HOSTS.has(host)) return youTubeTarget(url, host);
    if (TWITCH_HOSTS.has(host) || host === "clips.twitch.tv") return twitchTarget(url, host, options.parentHost);
    if (X_HOSTS.has(host)) return xTarget(url, options.dark);
    // Media served over plain http would be blocked as mixed content.
    if (url.protocol !== "https:") return null;
    return directMediaTarget(url, host);
}

/**
 * When the server's preview of a link is just an image with no page title, the link points straight
 * at an image. Returns that image's mxc:// URI, which is the server's own copy of it. (Synapse puts
 * the file's download name, often null, in og:description for these, so that isn't checked.)
 */
export function previewImageOnly(preview: IPreviewUrlResponse | null | undefined): string | undefined {
    if (!preview) return undefined;
    const image = preview["og:image"];
    if (typeof image !== "string" || !image.startsWith("mxc://")) return undefined;
    const type = preview["og:image:type"];
    if (typeof type === "string" && !type.startsWith("image/")) return undefined;
    const title = preview["og:title"];
    if (typeof title === "string" && title.trim().length > 0) return undefined;
    return image;
}

/** Whether the server's preview of a link has a title or description to show. */
export function hasPreviewText(preview: IPreviewUrlResponse | null | undefined): boolean {
    if (!preview) return false;
    const title = preview["og:title"];
    const description = preview["og:description"];
    return (
        (typeof title === "string" && title.trim().length > 0) ||
        (typeof description === "string" && description.trim().length > 0)
    );
}

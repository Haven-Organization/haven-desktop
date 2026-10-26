/*
 * Haven: rich embeds for links.
 *
 * Shows a link to YouTube, Twitch, X, or straight to an image or video file inline, so it can be
 * played or seen without leaving the app. Used by the room timeline and the Social app.
 *
 * When the server has a preview of the link (a title or description), the preview shows first,
 * with an Embed button and an "Always embed <site> links" checkbox. Embedding with the box ticked
 * remembers the site in account data, and that site's links embed right away from then on. Links
 * with no preview embed right away.
 */

import React, { type JSX, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type IPreviewUrlResponse } from "matrix-js-sdk/src/matrix";
import { logger as rootLogger } from "matrix-js-sdk/src/logger";
import { Button } from "@vector-im/compound-web";
import PlayIcon from "@vector-im/compound-design-tokens/assets/web/icons/play-solid";
import CloseIcon from "@vector-im/compound-design-tokens/assets/web/icons/close";
import PopOutIcon from "@vector-im/compound-design-tokens/assets/web/icons/pop-out";
import classNames from "classnames";

import { _t } from "../../../languageHandler";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { useSettingValue } from "../../../hooks/useSettings";
import { useTheme } from "../../../hooks/useTheme";
import SettingsStore from "../../../settings/SettingsStore";
import { SettingLevel } from "../../../settings/SettingLevel";
import { getCustomTheme } from "../../../theme";
import Modal from "../../../Modal";
import ImageView from "../elements/ImageView";
import {
    getRichEmbedTarget,
    hasPreviewText,
    previewImageOnly,
    type RichEmbedTarget,
} from "../../../utils/richEmbeds";

/** Sandbox for the embedded players: they need their own scripts and cookies, and to open links. */
const IFRAME_SANDBOX = "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation";
const IFRAME_ALLOW = "autoplay; encrypted-media; fullscreen; picture-in-picture";
const X_ORIGIN = "https://platform.twitter.com";

const logger = rootLogger.getChild("RichEmbed");

function isDarkTheme(theme: string): boolean {
    if (theme.startsWith("custom-")) {
        try {
            return !!getCustomTheme(theme.slice("custom-".length)).is_dark;
        } catch {
            return false;
        }
    }
    return theme.startsWith("dark");
}

/**
 * A function giving how to embed a link, or null when it can't be embedded or rich embeds are
 * turned off.
 */
export function useRichEmbedResolver(): (url: string | null | undefined) => RichEmbedTarget | null {
    const enabled = useSettingValue("Haven.richEmbeds");
    const { effectiveTheme } = useTheme();
    const dark = isDarkTheme(effectiveTheme);
    return useCallback(
        (url) => {
            if (!enabled || !url) return null;
            return getRichEmbedTarget(url, { parentHost: window.location.hostname, dark });
        },
        [enabled, dark],
    );
}

/** How to embed a link, or null when it can't be embedded or rich embeds are turned off. */
export function useRichEmbedTarget(url: string | null | undefined): RichEmbedTarget | null {
    const resolve = useRichEmbedResolver();
    return useMemo(() => resolve(url), [resolve, url]);
}

/** Whether links to this site always embed. */
export function useAlwaysEmbedSite(siteKey: string): [boolean, (always: boolean) => void] {
    const sites = useSettingValue("Haven.alwaysEmbedSites");
    const always = Array.isArray(sites) && sites.includes(siteKey);
    const setAlways = useCallback(
        (value: boolean) => {
            const current = SettingsStore.getValue("Haven.alwaysEmbedSites");
            const list = Array.isArray(current) ? current.filter((s) => s !== siteKey) : [];
            if (value) list.push(siteKey);
            SettingsStore.setValue("Haven.alwaysEmbedSites", null, SettingLevel.ACCOUNT, list).catch((e) =>
                logger.warn("Failed to save always-embedded sites", e),
            );
        },
        [siteKey],
    );
    return [always, setAlways];
}

type PreviewState = IPreviewUrlResponse | null | undefined;

/** The server's preview of a link: undefined while loading, null when there is none. */
function useServerPreview(url: string, ts: number, allowed: boolean): PreviewState {
    const client = useMatrixClientContext();
    const [preview, setPreview] = useState<PreviewState>(allowed ? undefined : null);
    useEffect(() => {
        if (!allowed) {
            setPreview(null);
            return;
        }
        let active = true;
        setPreview(undefined);
        client
            .getUrlPreview(url, ts)
            .then((data) => active && setPreview(data ?? null))
            .catch(() => active && setPreview(null));
        return () => {
            active = false;
        };
    }, [client, url, ts, allowed]);
    return preview;
}

export interface RichEmbedProps {
    /** The link. */
    url: string;
    /** How to embed it, from useRichEmbedTarget. */
    target: RichEmbedTarget;
    /** The event's timestamp, which the server's preview is looked up by. */
    ts: number;
    /** False where the link mustn't be sent to the server for a preview (encrypted rooms on bundled previews only). */
    allowServerPreview?: boolean;
    /** False when media is hidden here: nothing embeds without a click then. */
    autoEmbed?: boolean;
    /** Draws the server's preview card. Return null when there's nothing in it to show. */
    renderPreview: (preview: IPreviewUrlResponse) => ReactNode;
    /** Shown while the server's preview loads. */
    loading?: ReactNode;
    className?: string;
}

/**
 * A link's preview or its embed, with the controls to switch between them.
 */
export function RichEmbed({
    url,
    target,
    ts,
    allowServerPreview = true,
    autoEmbed = true,
    renderPreview,
    loading = null,
    className,
}: RichEmbedProps): JSX.Element | null {
    const client = useMatrixClientContext();
    const preview = useServerPreview(url, ts, allowServerPreview);
    const [always, setAlways] = useAlwaysEmbedSite(target.siteKey);
    // What the user picked here: "embed" plays straight away, "preview" goes back to the card.
    const [choice, setChoice] = useState<"embed" | "preview" | undefined>(undefined);
    // The checkbox starts at the site's current setting, so unticking it and embedding undoes it.
    // null = not touched here, follow the setting.
    const [rememberChoice, setRememberChoice] = useState<boolean | null>(null);
    const rememberSite = rememberChoice ?? always;

    const imageOnlyMxc = previewImageOnly(preview);
    const hasPreview = hasPreviewText(preview) && !imageOnlyMxc;

    // Nothing loads from the link's own site until the user asks (or has said to always embed it),
    // since that site would see the IP address of everyone the message is shown to. Only an image
    // the server has its own copy of shows straight away.
    let mode: "loading" | "preview" | "placeholder" | "embed";
    if (choice === "embed") mode = "embed";
    else if (choice === "preview") mode = hasPreview ? "preview" : "placeholder";
    else if (always && autoEmbed) mode = "embed";
    else if (preview === undefined) mode = "loading";
    else if (hasPreview) mode = "preview";
    else if (autoEmbed && target.kind === "image" && imageOnlyMxc) mode = "embed";
    else mode = "placeholder";

    const onEmbed = (): void => {
        if (rememberSite !== always) setAlways(rememberSite);
        setRememberChoice(null);
        setChoice("embed");
    };

    if (mode === "loading") return <>{loading}</>;

    if (mode === "embed") {
        // The server's copy of a linked image, so the image's own host never sees the request.
        const imageSrc = imageOnlyMxc ? (client.mxcUrlToHttp(imageOnlyMxc) ?? target.src) : target.src;
        return (
            <div
                className={classNames("mx_RichEmbed", `mx_RichEmbed--${target.kind}`, className, {
                    "mx_RichEmbed--portrait": (target.aspectRatio ?? 1) < 1,
                })}
            >
                <EmbeddedMedia
                    target={target}
                    url={url}
                    imageSrc={imageSrc}
                    preview={preview}
                    autoplay={choice === "embed"}
                />
                {(target.kind === "youtube" || target.kind === "twitch" || target.kind === "x") && (
                    <div className="mx_RichEmbed_bar">
                        <a
                            className="mx_RichEmbed_open"
                            href={url}
                            target="_blank"
                            rel="noreferrer noopener"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <PopOutIcon width="16" height="16" aria-hidden />
                            {target.siteLabel}
                        </a>
                        {hasPreview && (
                            <button
                                type="button"
                                className="mx_RichEmbed_close"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setChoice("preview");
                                }}
                            >
                                <CloseIcon width="16" height="16" aria-hidden />
                                {_t("timeline|url_preview|close_embed")}
                            </button>
                        )}
                    </div>
                )}
            </div>
        );
    }

    const actions = (
        <div className="mx_RichEmbed_actions" onClick={(e) => e.stopPropagation()}>
            <Button kind="secondary" size="md" Icon={PlayIcon} onClick={onEmbed}>
                {_t("timeline|url_preview|embed", { site: target.siteKey })}
            </Button>
            <label className="mx_RichEmbed_remember">
                <input type="checkbox" checked={rememberSite} onChange={(e) => setRememberChoice(e.target.checked)} />
                {_t("timeline|url_preview|always_embed_site", { site: target.siteKey })}
            </label>
        </div>
    );

    if (mode === "placeholder") {
        return (
            <div
                className={classNames(
                    "mx_RichEmbed",
                    "mx_RichEmbed--placeholder",
                    `mx_RichEmbed_placeholder--${target.kind}`,
                    className,
                )}
            >
                <div className="mx_RichEmbed_placeholder">
                    <span className="mx_RichEmbed_placeholderLabel">{placeholderLabel(target)}</span>
                    {actions}
                </div>
            </div>
        );
    }

    const card = preview && hasPreview ? renderPreview(preview) : null;
    return (
        <div className={classNames("mx_RichEmbed", "mx_RichEmbed--preview", className)}>
            {card}
            {actions}
        </div>
    );
}

/** What the placeholder says it would load. */
function placeholderLabel(target: RichEmbedTarget): string {
    switch (target.kind) {
        case "video":
            return _t("timeline|url_preview|placeholder_video", { site: target.siteKey });
        case "image":
            return _t("timeline|url_preview|placeholder_image", { site: target.siteKey });
        case "x":
            return _t("timeline|url_preview|placeholder_post", { site: target.siteKey });
        default:
            return _t("timeline|url_preview|placeholder_player", { site: target.siteKey });
    }
}

function previewNumber(preview: PreviewState, key: string): number | undefined {
    const value = Number(preview?.[key]);
    return Number.isFinite(value) && value > 0 ? value : undefined;
}

function EmbeddedMedia({
    target,
    url,
    imageSrc,
    preview,
    autoplay,
}: {
    target: RichEmbedTarget;
    url: string;
    imageSrc: string;
    preview: PreviewState;
    autoplay: boolean;
}): JSX.Element {
    switch (target.kind) {
        case "image":
            return <EmbeddedImage src={imageSrc} url={url} preview={preview} />;
        case "video":
            return <EmbeddedVideo src={target.src} autoplay={autoplay} />;
        case "x":
            return <XPostEmbed src={target.src} />;
        default:
            return <PlayerEmbed target={target} preview={preview} autoplay={autoplay} />;
    }
}

function EmbeddedImage({ src, url, preview }: { src: string; url: string; preview: PreviewState }): JSX.Element {
    const [failed, setFailed] = useState(false);
    const width = previewNumber(preview, "og:image:width");
    const height = previewNumber(preview, "og:image:height");
    if (failed) return <EmbedFailed url={url} />;
    return (
        <button
            type="button"
            className="mx_RichEmbed_imageButton"
            onClick={(e) => {
                e.stopPropagation();
                Modal.createDialog(
                    ImageView,
                    { src, width, height, name: url, link: url },
                    "mx_Dialog_lightbox",
                    undefined,
                    true,
                );
            }}
        >
            <img
                className="mx_RichEmbed_image"
                src={src}
                alt=""
                loading="lazy"
                decoding="async"
                // Reserve the space before the image loads so the timeline doesn't jump.
                style={width && height ? { aspectRatio: `${width} / ${height}`, width: `${width}px` } : undefined}
                onError={() => setFailed(true)}
            />
        </button>
    );
}

function EmbeddedVideo({ src, autoplay }: { src: string; autoplay: boolean }): JSX.Element {
    const [failed, setFailed] = useState(false);
    if (failed) return <EmbedFailed url={src} />;
    return (
        <video
            className="mx_RichEmbed_video"
            src={src}
            controls
            playsInline
            preload="metadata"
            autoPlay={autoplay}
            onClick={(e) => e.stopPropagation()}
            onError={() => setFailed(true)}
        />
    );
}

function EmbedFailed({ url }: { url: string }): JSX.Element {
    return (
        <div className="mx_RichEmbed_failed">
            {_t("timeline|url_preview|embed_failed")}{" "}
            <a href={url} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>
                {_t("timeline|url_preview|open_link")}
            </a>
        </div>
    );
}

/**
 * A YouTube or Twitch player. Unless the user just clicked Embed, it starts as a cover with a play
 * button, so a timeline full of always-embedded links doesn't load a player for each one.
 */
function PlayerEmbed({
    target,
    preview,
    autoplay,
}: {
    target: RichEmbedTarget;
    preview: PreviewState;
    autoplay: boolean;
}): JSX.Element {
    const client = useMatrixClientContext();
    const [playing, setPlaying] = useState(autoplay);
    const title = typeof preview?.["og:title"] === "string" ? preview["og:title"] : target.siteLabel;
    const style = { aspectRatio: String(target.aspectRatio ?? 16 / 9) };

    if (!playing) {
        const ogImage = typeof preview?.["og:image"] === "string" ? preview["og:image"] : undefined;
        const thumbnail = target.thumbnail ?? (ogImage ? client.mxcUrlToHttp(ogImage, 640, 360, "scale") : null);
        return (
            <button
                type="button"
                className="mx_RichEmbed_cover"
                style={style}
                aria-label={_t("timeline|url_preview|play_embed", { title })}
                onClick={(e) => {
                    e.stopPropagation();
                    setPlaying(true);
                }}
            >
                {thumbnail && <img src={thumbnail} alt="" loading="lazy" decoding="async" />}
                <span className="mx_RichEmbed_coverTitle">{title}</span>
                <span className="mx_RichEmbed_playButton" aria-hidden>
                    <PlayIcon width="32" height="32" />
                </span>
            </button>
        );
    }

    const src = new URL(target.src);
    // The player only loads once the user has asked to play it.
    src.searchParams.set("autoplay", target.kind === "youtube" ? "1" : "true");
    return (
        <iframe
            className="mx_RichEmbed_player"
            style={style}
            src={src.toString()}
            title={title}
            sandbox={IFRAME_SANDBOX}
            allow={IFRAME_ALLOW}
            allowFullScreen
            // The app's page sends no referrer, and YouTube's player refuses to play without one.
            referrerPolicy="strict-origin-when-cross-origin"
        />
    );
}

/** Pull the height out of X's embed resize message. */
export function xEmbedHeight(data: unknown): number | undefined {
    let message = data;
    if (typeof message === "string") {
        try {
            message = JSON.parse(message);
        } catch {
            return undefined;
        }
    }
    const embed = (message as Record<string, unknown> | null)?.["twttr.embed"] as
        | { method?: unknown; params?: unknown }
        | undefined;
    if (embed?.method !== "twttr.private.resize" || !Array.isArray(embed.params)) return undefined;
    const height = Number((embed.params[0] as { height?: unknown } | undefined)?.height);
    return Number.isFinite(height) && height > 0 ? Math.ceil(height) : undefined;
}

/** An X post, sized to its content as X reports it. */
function XPostEmbed({ src }: { src: string }): JSX.Element {
    const ref = useRef<HTMLIFrameElement>(null);
    const [height, setHeight] = useState<number | undefined>(undefined);
    useEffect(() => {
        const onMessage = (e: MessageEvent): void => {
            if (e.origin !== X_ORIGIN || e.source !== ref.current?.contentWindow) return;
            const h = xEmbedHeight(e.data);
            if (h) setHeight(h);
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, []);
    return (
        <iframe
            ref={ref}
            className={classNames("mx_RichEmbed_xPost", { mx_RichEmbed_xPost_sized: height !== undefined })}
            style={height ? { height: `${height}px` } : undefined}
            src={src}
            title="X"
            sandbox={IFRAME_SANDBOX}
            allow={IFRAME_ALLOW}
            allowFullScreen
            loading="lazy"
        />
    );
}

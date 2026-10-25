/*
 * Social Overlay - SocialMediaFrame
 *
 * Holds a post's image or video at the full width of the post, with a blurred copy of the media
 * filling the space beside anything narrower than the post (a portrait photo, a small image), so a
 * post's media always spans the post instead of leaving empty space beside it.
 *
 * The blurred copy is the media's own blurhash when it has one (MSC2448, drawn into a tiny canvas
 * with no request), otherwise a small server thumbnail of it. Most bridged media has no blurhash.
 */

import React from "react";
import { Blurhash } from "react-blurhash";

import { MatrixClientPeg } from "../../../../element-web/apps/web/src/MatrixClientPeg";
import { BLURHASH_FIELD } from "../../../../element-web/apps/web/src/utils/image-media";

/** Size of the thumbnail used for the blurred backdrop - it's blurred heavily, so tiny is enough. */
const BACKDROP_THUMBNAIL_SIZE = 32;

/** Media at most this many pixels in both directions stays at its own size rather than being
 *  scaled up to the post's width, where it would look blurry. */
const NATURAL_SIZE_LIMIT = 160;

interface Props {
    /** Class(es) for the frame itself, e.g. the post or repost card's own media wrapper class. */
    className: string;
    /** The media's content.info, for its blurhash. */
    info?: object;
    /** The media's unencrypted mxc:// URL, for the backdrop thumbnail when there's no blurhash. */
    mxc?: string;
    /** Used as the backdrop when there's neither a blurhash nor an unencrypted mxc:// URL. */
    fallbackSrc?: string | null;
    children: React.ReactNode;
}

export function SocialMediaFrame({ className, info: rawInfo, mxc, fallbackSrc, children }: Props): React.JSX.Element {
    const info = rawInfo as Record<string, unknown> | undefined;
    const blurhash = typeof info?.[BLURHASH_FIELD] === "string" ? (info[BLURHASH_FIELD] as string) : undefined;
    let backdrop: React.ReactNode = null;
    if (blurhash) {
        backdrop = <Blurhash hash={blurhash} width="100%" height="100%" resolutionX={32} resolutionY={32} />;
    } else {
        const thumb = mxc?.startsWith("mxc://")
            ? MatrixClientPeg.get()?.mxcUrlToHttp(mxc, BACKDROP_THUMBNAIL_SIZE, BACKDROP_THUMBNAIL_SIZE, "scale")
            : null;
        const src = thumb ?? fallbackSrc;
        if (src) backdrop = <img src={src} alt="" loading="lazy" decoding="async" />;
    }

    const { w, h } = (info ?? {}) as { w?: unknown; h?: unknown };
    const isSmall =
        typeof w === "number" && typeof h === "number" && w > 0 && h > 0 && w <= NATURAL_SIZE_LIMIT && h <= NATURAL_SIZE_LIMIT;

    return (
        <div className={`${className} social_MediaFrame${isSmall ? " social_MediaFrame--natural" : ""}`}>
            {backdrop && (
                <div className="social_MediaFrame_backdrop" aria-hidden="true">
                    {backdrop}
                </div>
            )}
            {children}
        </div>
    );
}

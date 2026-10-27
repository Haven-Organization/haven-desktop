/*
 * Haven: a webxdc game drawn as a handheld game cartridge, with the game's icon as its label, the
 * way the Nostr bridge and Ditto show games. The color comes from the game file's mxc:// URI, so
 * the same file looks the same wherever it's posted or forwarded. Same shapes as the bridge's
 * cartridge.py, as SVG.
 */

import React, { type JSX, useId, useState } from "react";

/** Body colors, as the bridge has them. */
const PALETTE = ["#1ba5c4", "#de6a0e", "#8e2fe0", "#d93b3b", "#2fa84f", "#2f6fdb", "#e0489b", "#e3b21f", "#7d8592"];

/**
 * The game's body color, from its file's mxc:// URI, so the same file looks the same everywhere it's
 * posted or forwarded. (FNV-1a: small and the same in every client.)
 */
export function cartridgeColor(seed: string | undefined): string {
    if (!seed) return PALETTE[0];
    let hash = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) {
        hash ^= seed.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return PALETTE[hash % PALETTE.length];
}

/** Darker below 1, lighter above. */
export function shade(hex: string, factor: number): string {
    const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const shaded = channels.map((c) => Math.round(factor < 1 ? c * factor : c + (255 - c) * (factor - 1)));
    return `rgb(${shaded.join(", ")})`;
}

// The label's box, inside the 480 x 560 cartridge.
const LABEL = { x: 112, y: 126, width: 256, height: 256 };
/** An icon at most this size is pixel art, scaled up without smoothing. */
const PIXEL_ART_MAX = (LABEL.width - 24) / 3;

interface Props {
    /** What the color comes from: the game file's mxc:// URI. */
    colorSeed?: string;
    /** The game's icon, if it has one. */
    iconUrl?: string;
    /** Written on the label when there's no icon. */
    title: string;
}

export function WebxdcCartridge({ colorSeed, iconUrl, title }: Props): JSX.Element {
    const id = useId();
    const color = cartridgeColor(colorSeed);
    const dark = shade(color, 0.72);
    const darker = shade(color, 0.5);
    const light = shade(color, 1.28);
    const [pixelArt, setPixelArt] = useState(false);

    const grips: JSX.Element[] = [];
    for (let y = 34; y < 128; y += 10) {
        grips.push(
            <line key={`l${y}`} x1={22} y1={y} x2={46} y2={y} />,
            <line key={`r${y}`} x1={432} y1={y} x2={456} y2={y} />,
        );
    }
    const pins: JSX.Element[] = [];
    for (let x = 56; x < 428; x += 12) pins.push(<line key={x} x1={x} y1={518} x2={x} y2={530} />);

    const inset = 12;
    return (
        <svg className="mx_WebxdcCartridge" viewBox="0 0 480 560" role="img" aria-label={title}>
            <defs>
                <clipPath id={`${id}-label`}>
                    <rect
                        x={LABEL.x + inset}
                        y={LABEL.y + inset}
                        width={LABEL.width - inset * 2}
                        height={LABEL.height - inset * 2}
                        rx={12}
                    />
                </clipPath>
            </defs>
            {/* Shadow, body, and its lit and shaded edges. */}
            <rect x={26} y={18} width={440} height={534} rx={16} fill="rgb(0 0 0 / 27%)" />
            <rect x={20} y={10} width={440} height={534} rx={16} fill={darker} />
            <rect x={20} y={10} width={436} height={528} rx={16} fill={color} />
            <rect x={21.5} y={11.5} width={429} height={519} rx={16} fill="none" stroke={light} strokeWidth={3} />
            {/* Grips down both sides, near the top. */}
            <g stroke={dark} strokeWidth={4}>
                {grips}
            </g>
            {/* The slot-shaped recess at the top. */}
            <rect x={112} y={22} width={256} height={56} rx={28} fill={dark} stroke={darker} strokeWidth={3} />
            <rect x={118} y={28} width={244} height={44} rx={22} fill={color} />
            {/* The label's frame. */}
            <rect x={62} y={100} width={356} height={338} rx={10} fill={dark} stroke={darker} strokeWidth={5} />
            <rect x={74} y={112} width={332} height={314} rx={6} fill="none" stroke={darker} strokeWidth={2} />
            {/* The label. */}
            <rect x={LABEL.x} y={LABEL.y} width={LABEL.width} height={LABEL.height} rx={20} fill="#cbd4de" />
            {iconUrl ? (
                <image
                    href={iconUrl}
                    x={LABEL.x + inset}
                    y={LABEL.y + inset}
                    width={LABEL.width - inset * 2}
                    height={LABEL.height - inset * 2}
                    preserveAspectRatio="xMidYMid meet"
                    clipPath={`url(#${id}-label)`}
                    style={pixelArt ? { imageRendering: "pixelated" } : undefined}
                    onLoad={(e) => {
                        // An SVG <image> doesn't report its natural size, so it's read from a copy.
                        const probe = new Image();
                        probe.onload = () => setPixelArt(Math.max(probe.width, probe.height) <= PIXEL_ART_MAX);
                        probe.src = (e.target as SVGImageElement).href.baseVal;
                    }}
                />
            ) : (
                <foreignObject x={LABEL.x + 16} y={LABEL.y + 16} width={LABEL.width - 32} height={LABEL.height - 32}>
                    <div className="mx_WebxdcCartridge_title">{title || "🎮"}</div>
                </foreignObject>
            )}
            {/* The arrow, and the edge that goes into the console. */}
            <polygon points="206,452 274,452 240,488" fill={dark} stroke={darker} />
            <rect x={44} y={512} width={392} height={22} rx={4} fill={darker} />
            <g stroke={dark} strokeWidth={3}>
                {pins}
            </g>
        </svg>
    );
}

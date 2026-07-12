/*
 * Haven apps framework — AppsGridIcon
 *
 * A 3x3 grid glyph for the Apps launcher button. No equivalent exists in
 * @vector-im/compound-design-tokens (closest is a 2x2 GridIcon, and it's single-color) — this
 * follows that icon's own conventions (24x24 viewBox, forwardRef) but, unlike a stock compound
 * icon, deliberately does NOT use fill: currentColor — each square has its own fixed color (a
 * classic multi-color "app launcher" look, e.g. Google's/Microsoft's own grid icons), by request,
 * so it doesn't just recolor to match its container the way every other icon here does.
 */

import React, { forwardRef } from "react";

const SIZE = 5;
const GAP = 2;
const MARGIN = 2.5;

// One distinct, reasonably vivid color per square — order doesn't map to anything, just a
// pleasant mosaic rather than a gradient or theme-matched palette. Deliberately avoids anything in
// the green/teal/cyan family: $accent (the "button selected" color applied to this button's own
// background - see apps-framework.scss's .haven_AppsButton_compactIcon--active /
// .haven_SpaceAppButton--active) is itself a teal-green (~165° hue, e.g. rgb(18, 154, 120)/#0dbd8b
// depending on theme), and having a square anywhere near that family reads as "already selected" at
// a glance. Replaced #22c55e (green, ~142°) and #14b8a6 (teal, ~173° - nearly identical to $accent)
// with indigo and slate; #06b6d4 (cyan, ~189°) was still close enough to read as teal-ish too, so
// that's now fuchsia instead - the remaining colors (blue/amber/pink/purple/red/yellow) all sit far
// enough from 165° on the wheel to not cause the same confusion.
const COLORS = ["#6366f1", "#3b82f6", "#f59e0b", "#ec4899", "#8b5cf6", "#475569", "#ef4444", "#eab308", "#d946ef"];

function cell(row: number, col: number): { x: number; y: number } {
    return { x: MARGIN + col * (SIZE + GAP), y: MARGIN + row * (SIZE + GAP) };
}

export const AppsGridIcon = forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>(function AppsGridIcon(
    props,
    ref,
) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" ref={ref} {...props}>
            {[0, 1, 2].map((row) =>
                [0, 1, 2].map((col) => {
                    const { x, y } = cell(row, col);
                    const i = row * 3 + col;
                    return <rect key={`${row}-${col}`} x={x} y={y} width={SIZE} height={SIZE} rx="1" fill={COLORS[i]} />;
                }),
            )}
        </svg>
    );
});

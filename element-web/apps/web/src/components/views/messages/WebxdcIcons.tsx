/*
 * Haven: icons for webxdc game buttons that Compound has no icon for, drawn to match its icons.
 */

import React, { type JSX, type SVGAttributes } from "react";

/** Compound's pop-out icon turned around: the arrow goes into the box. */
export function PopInIcon(props: SVGAttributes<SVGElement>): JSX.Element {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="1em"
            height="1em"
            fill="currentColor"
            viewBox="0 0 24 24"
            {...props}
        >
            <path d="M5 3h6a1 1 0 1 1 0 2H5v14h14v-6a1 1 0 1 1 2 0v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2" />
            <path d="M11 13V8a1 1 0 1 1 2 0v2.586l6.293-6.293a1 1 0 1 1 1.414 1.414L14.414 12H17a1 1 0 1 1 0 2h-5a1 1 0 0 1-1-1" />
        </svg>
    );
}

/** A floppy disk, for saving a game. */
export function SaveGameIcon(props: SVGAttributes<SVGElement>): JSX.Element {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="1em"
            height="1em"
            fill="currentColor"
            viewBox="0 0 24 24"
            {...props}
        >
            <path d="M5 3h11.586a2 2 0 0 1 1.414.586l2.414 2.414A2 2 0 0 1 21 7.414V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2m0 2v14h2v-5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v5h2V7.414L16.586 5H16v3a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V5zm5 0v2h4V5zm5 14v-4H9v4z" />
        </svg>
    );
}

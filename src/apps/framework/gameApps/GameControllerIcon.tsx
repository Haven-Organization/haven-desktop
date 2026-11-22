/*
 * Haven apps framework - a game controller, for game apps without an icon of their own (Flash
 * games have none). Compound has no game icon; drawn to match its icons.
 */

import React, { type JSX, type SVGAttributes } from "react";

export function GameControllerIcon(props: SVGAttributes<SVGElement>): JSX.Element {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="1em"
            height="1em"
            fill="currentColor"
            viewBox="0 0 24 24"
            {...props}
        >
            <path d="M7.5 5h9a5.5 5.5 0 0 1 5.4 6.55l-.9 4.7A3.4 3.4 0 0 1 17.66 19a3.4 3.4 0 0 1-2.75-1.4L13.7 16h-3.4l-1.21 1.6A3.4 3.4 0 0 1 6.34 19 3.4 3.4 0 0 1 3 16.25l-.9-4.7A5.5 5.5 0 0 1 7.5 5m0 2a3.5 3.5 0 0 0-3.44 4.17l.9 4.7c.13.64.7 1.13 1.38 1.13.44 0 .86-.21 1.13-.57l1.5-1.98A1 1 0 0 1 9.8 14h4.4a1 1 0 0 1 .8.43l1.5 1.98c.27.36.69.57 1.13.57.69 0 1.25-.49 1.38-1.13l.9-4.7A3.5 3.5 0 0 0 16.5 7z" />
            <path d="M8 8.5a1 1 0 0 1 1 1V10h.5a1 1 0 1 1 0 2H9v.5a1 1 0 1 1-2 0V12h-.5a1 1 0 1 1 0-2H7v-.5a1 1 0 0 1 1-1M15.5 9.25a1 1 0 1 1 0 2 1 1 0 0 1 0-2M17.5 11.25a1 1 0 1 1 0 2 1 1 0 0 1 0-2" />
        </svg>
    );
}

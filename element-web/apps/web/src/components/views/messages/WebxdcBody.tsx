/*
 * Haven: a webxdc game file in a room's timeline. See WebxdcGame.
 */

import React, { type JSX } from "react";

import { type IBodyProps } from "./IBodyProps";
import { WebxdcGame } from "./WebxdcGame";

export default function WebxdcBody({ ref, mxEvent, mediaEventHelper }: IBodyProps): JSX.Element {
    return (
        <div ref={ref as React.Ref<HTMLDivElement>} className="mx_WebxdcBody">
            <WebxdcGame mxEvent={mxEvent} mediaEventHelper={mediaEventHelper} />
        </div>
    );
}

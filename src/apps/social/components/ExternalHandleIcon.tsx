/*
 * Social Overlay — ExternalHandleIcon
 *
 * A compact icon-only rendering of an MSC4503 external handle, shown inline next to a post's
 * sender name (the main post header, and the embedded original author's name on a repost/reply
 * card) - distinct from ExternalHandleBadge.tsx, which shows the full handle text plus a link icon
 * in the RightPanel/profile-room header context. Renders nothing when there's no protocol.avatar_url
 * to show - a handle with no protocol icon has nothing worth rendering here.
 */

import React, { type JSX } from "react";
import { Tooltip } from "@vector-im/compound-web";

import { type ExternalHandle } from "../utils/liveUserProfile";
import { useMatrixClientContext } from "../../../../element-web/apps/web/src/contexts/MatrixClientContext";

interface Props {
    externalHandle: ExternalHandle | undefined;
    className?: string;
}

export function ExternalHandleIcon({ externalHandle, className }: Props): JSX.Element | null {
    const client = useMatrixClientContext();
    const avatarHttpUrl = externalHandle?.protocol.avatar_url
        ? client.mxcUrlToHttp(externalHandle.protocol.avatar_url, 16, 16, "crop")
        : null;
    if (!avatarHttpUrl) return null;

    return (
        <Tooltip label={externalHandle!.handle}>
            <img
                src={avatarHttpUrl}
                alt=""
                className={className ? `social_ExternalHandleIcon ${className}` : "social_ExternalHandleIcon"}
            />
        </Tooltip>
    );
}

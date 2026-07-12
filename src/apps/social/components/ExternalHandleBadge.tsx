/*
 * Social Overlay — ExternalHandleBadge
 *
 * Renders an MSC4503 external handle (e.g. a Fediverse/ActivityPub handle linked to a Matrix
 * account) under the MXID, in both the stock member RightPanel (UserInfoHeaderView.tsx) and a
 * profile room's own header (SocialRoomView.tsx) - same rules in both places, hence one shared
 * component. `protocol.avatar_url`/`protocol.displayname` identify the *protocol* itself (e.g. a
 * Fediverse logo and the word "Fediverse"), not the user - see liveUserProfile.ts's own comment.
 */

import React, { type JSX } from "react";
import { Text, Tooltip } from "@vector-im/compound-web";
import LinkIcon from "@vector-im/compound-design-tokens/assets/web/icons/link";

import { type ExternalHandle } from "../utils/liveUserProfile";
import { useMatrixClientContext } from "../../../../element-web/apps/web/src/contexts/MatrixClientContext";
import AccessibleButton from "../../../../element-web/apps/web/src/components/views/elements/AccessibleButton";
import { openExternalHandleLink } from "../utils/openExternalHandleLink";

interface Props {
    externalHandle: ExternalHandle;
    className?: string;
}

export function ExternalHandleBadge({ externalHandle, className }: Props): JSX.Element {
    const client = useMatrixClientContext();
    const { handle, protocol, url } = externalHandle;

    const avatarHttpUrl = protocol.avatar_url ? client.mxcUrlToHttp(protocol.avatar_url, 16, 16, "crop") : null;

    return (
        <Text size="sm" weight="semibold" className={className ? `social_ExternalHandleBadge ${className}` : "social_ExternalHandleBadge"}>
            <span className="social_ExternalHandleBadge_handle">{handle}</span>
            {/* Protocol icon and link icon grouped together on the right, next to each other -
                the handle text itself takes the primary/leading position. */}
            {avatarHttpUrl && (
                <Tooltip label={protocol.displayname || protocol.id}>
                    <img src={avatarHttpUrl} alt="" className="social_ExternalHandleBadge_protocolIcon" />
                </Tooltip>
            )}
            {url && (
                <Tooltip label={url}>
                    <AccessibleButton
                        element="button"
                        className="social_ExternalHandleBadge_link"
                        onClick={() => openExternalHandleLink(url)}
                        aria-label={url}
                    >
                        <LinkIcon />
                    </AccessibleButton>
                </Tooltip>
            )}
        </Text>
    );
}

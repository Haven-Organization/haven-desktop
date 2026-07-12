/*
 * Social Overlay — NotificationsButton
 *
 * The exact same notifications bell as stock RoomHeader (same icon, same indicator, same
 * ToggleableIcon highlight-when-open behavior) — that JSX is inlined in RoomHeaderButtons rather
 * than exported, so it's reproduced here verbatim rather than imported, but every piece it uses
 * (useGlobalNotificationState, ToggleableIcon, notificationLevelToIndicator, RightPanelPhases) is
 * the real stock code, not a reimplementation. Positioned persistently top-right of the whole
 * Social layout, regardless of which pane/room is active — see SocialHomeView's
 * `toggleNotifications`, which calls the same `RightPanelStore.showOrHidePhase` stock RoomHeader
 * calls. Gated on the same `feature_notifications` lab flag stock RoomHeader gates its own bell on
 * — renders nothing at all if that lab isn't enabled, matching stock exactly.
 */

import React, { type JSX } from "react";
import { Tooltip, IconButton } from "@vector-im/compound-web";
import NotificationsIcon from "@vector-im/compound-design-tokens/assets/web/icons/notifications-solid";

import { useGlobalNotificationState } from "../../../../element-web/apps/web/src/hooks/useGlobalNotificationState";
import { notificationLevelToIndicator } from "../../../../element-web/apps/web/src/utils/notifications";
import { RightPanelPhases } from "../../../../element-web/apps/web/src/stores/right-panel/RightPanelStorePhases";
import { ToggleableIcon } from "../../../../element-web/apps/web/src/components/views/rooms/RoomHeader/toggle/ToggleableIcon";
import { useFeatureEnabled } from "../../../../element-web/apps/web/src/hooks/useSettings";

interface Props {
    onToggle: () => void;
}

export function NotificationsButton({ onToggle }: Props): JSX.Element | null {
    const notificationsEnabled = useFeatureEnabled("feature_notifications");
    const globalNotificationState = useGlobalNotificationState();

    if (!notificationsEnabled) return null;

    return (
        <div className="social_NotificationsButton">
            <Tooltip label="Notifications">
                <IconButton
                    indicator={notificationLevelToIndicator(globalNotificationState.level)}
                    onClick={onToggle}
                    aria-label="Notifications"
                >
                    <ToggleableIcon Icon={NotificationsIcon} phase={RightPanelPhases.NotificationPanel} />
                </IconButton>
            </Tooltip>
        </div>
    );
}

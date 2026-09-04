/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import { Text } from "@vector-im/compound-web";

import { type IDevice } from "../right_panel/UserInfo";
import BaseDialog from "./BaseDialog";
import CopyableText from "../elements/CopyableText";
import E2EIcon from "../rooms/E2EIcon";
import { E2EStatus } from "../../../utils/ShieldUtils";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import { useAsyncMemo } from "../../../hooks/useAsyncMemo";
import { _t } from "../../../languageHandler";

interface IProps {
    devices: IDevice[];
    onFinished(): void;
}

/**
 * Haven: lists another user's devices (see UserInfoBasicOptionsView.tsx's own "View Devices" button,
 * the only caller - a developer-mode-only option, same gating as "View Profile Data" next to it).
 * `devices` is passed in already-fetched, rather than re-queried here - see
 * UserInfo.tsx's own useDevices() doc: it's backed by MatrixClient.getCrypto().getUserDeviceInfo(),
 * which reads the SDK's own already-synced local device-list cache (kept fresh in the background by
 * the same /keys/query machinery E2E encryption already depends on) rather than a fresh network
 * round-trip on every panel open - this dialog piggybacks on that same already-live data instead of
 * triggering a second, redundant fetch of its own.
 *
 * Only device ID, display name, and verification status are shown - the Matrix federation API
 * genuinely doesn't expose anything more than that for another user's devices (no last-seen IP/
 * timestamp; those only exist on the account's own /devices endpoint for its own sessions).
 */
const UserDevicesDialog: React.FC<IProps> = ({ devices, onFinished }) => {
    return (
        <BaseDialog
            className="mx_UserDevicesDialog"
            hasCancel={true}
            onFinished={onFinished}
            title={_t("user_info|devices_dialog_title", { count: devices.length })}
        >
            {devices.length === 0 ? (
                <Text size="sm" className="mx_UserDevicesDialog_empty">
                    {_t("user_info|devices_dialog_empty")}
                </Text>
            ) : (
                <ul className="mx_UserDevicesDialog_list">
                    {devices.map((device) => (
                        <UserDevicesDialogDevice key={device.deviceId} device={device} />
                    ))}
                </ul>
            )}
        </BaseDialog>
    );
};

const UserDevicesDialogDevice: React.FC<{ device: IDevice }> = ({ device }) => {
    // Local-only (no network call): derived from cross-signing/device data the SDK already holds,
    // same as devtools/Users.tsx's own DeviceButton - see MatrixClient.getCrypto()'s own doc on
    // getDeviceVerificationStatus.
    const status = useAsyncMemo(
        async () => MatrixClientPeg.safeGet().getCrypto()?.getDeviceVerificationStatus(device.userId, device.deviceId),
        [device],
        undefined,
    );

    let e2eStatus: E2EStatus | undefined;
    if (status) {
        e2eStatus = status.crossSigningVerified ? E2EStatus.Verified : status.signedByOwner ? E2EStatus.Normal : E2EStatus.Warning;
    }

    const hasName = !!device.displayName?.trim();
    // Ambiguous (two devices sharing the same display name) is already computed once for the whole
    // list by UserInfo.tsx's own disambiguateDevices() - see IDevice's own doc.
    const name = hasName ? (device.ambiguous ? `${device.displayName} (${device.deviceId})` : device.displayName) : device.deviceId;

    return (
        <li className="mx_UserDevicesDialog_device">
            {e2eStatus && <E2EIcon isUser={true} hideTooltip={true} status={e2eStatus} className="mx_UserDevicesDialog_device_icon" />}
            <div className="mx_UserDevicesDialog_device_info">
                <Text size="md" weight="medium" className="mx_UserDevicesDialog_device_name">
                    {name}
                </Text>
                {hasName && (
                    <CopyableText getTextToCopy={() => device.deviceId} border={false} className="mx_UserDevicesDialog_device_id">
                        {device.deviceId}
                    </CopyableText>
                )}
            </div>
        </li>
    );
};

export default UserDevicesDialog;

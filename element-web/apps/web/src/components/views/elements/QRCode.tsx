/*
Copyright 2024 New Vector Ltd.
Copyright 2020 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import { toDataURL, type QRCodeSegment, type QRCodeToDataURLOptions, type QRCodeRenderersOptions } from "qrcode";
import classNames from "classnames";

import { _t } from "../../../languageHandler";
import Spinner from "./Spinner";

interface IProps extends QRCodeRenderersOptions {
    /** The data for the QR code. If `null`, a spinner is shown. */
    data: null | string | QRCodeSegment[];
    className?: string;
}

const defaultOptions: QRCodeToDataURLOptions = {
    errorCorrectionLevel: "L", // we want it as trivial-looking as possible
};

/** Haven: some browsers (Brave's canvas-fingerprinting mitigation, and similar privacy hardening
 *  elsewhere) deliberately randomize canvas pixel-readback per call so it can't be used to
 *  fingerprint the device - the same draw produces a *different* toDataURL() result every time.
 *  That's normally harmless, but was fatal here: combined with this component's own effect
 *  re-running on every render (see the now-fixed dependency bug below), every resolved-and-
 *  different URI was a real state change, which re-rendered, which re-ran the encode, which
 *  produced yet another different URI, forever - each step was a resolved microtask, so the
 *  browser never got a chance to yield back to painting or input either, hanging the whole
 *  window rather than just this component. Detected here by encoding the same data twice and
 *  comparing: a real, unmitigated canvas returns byte-identical output for identical input, so a
 *  mismatch means privacy mitigations are scrambling the readback - no amount of retrying will
 *  ever produce a stable (or even scannable) QR code, so this renders nothing instead of looping
 *  forever trying. */
async function encodeDeterministically(
    data: string | QRCodeSegment[],
    options: QRCodeToDataURLOptions,
): Promise<string | null> {
    const [first, second] = await Promise.all([toDataURL(data, options), toDataURL(data, options)]);
    return first === second ? first : null;
}

const QRCode: React.FC<IProps> = ({ data, className, ...options }) => {
    const [dataUri, setUri] = React.useState<string | null>(null);
    const [unavailable, setUnavailable] = React.useState(false);
    // Haven: stringified so this only changes when the actual option *values* do - options itself
    // is a fresh object every render (it's built by rest-spreading this component's own props),
    // so using it directly as a dependency made the effect below re-run on every render
    // regardless of whether anything real had changed - the other half of what made this
    // component loop forever under canvas privacy mitigations (see encodeDeterministically above).
    const optionsKey = JSON.stringify(options);

    React.useEffect(() => {
        if (data === null) {
            setUri(null);
            setUnavailable(false);
            return;
        }
        let cancelled = false;
        encodeDeterministically(data, { ...defaultOptions, ...options })
            .then((uri) => {
                if (cancelled) return;
                if (uri === null) {
                    setUnavailable(true);
                } else {
                    setUri(uri);
                }
            })
            .catch(() => {
                if (!cancelled) setUnavailable(true);
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [JSON.stringify(data), optionsKey]);

    return (
        <div className={classNames("mx_QRCode", className)}>
            {unavailable ? (
                <div className="mx_QRCode_unavailable">{_t("common|qr_code_unavailable")}</div>
            ) : dataUri ? (
                <img src={dataUri} className="mx_VerificationQRCode" alt={_t("common|qr_code")} />
            ) : (
                <Spinner />
            )}
        </div>
    );
};

export default QRCode;

/*
 * Social Overlay — ExternalHandleLinkWarningDialog
 *
 * Confirmation modal shown before opening an MSC4503 external handle's link, unless its domain is
 * already marked trusted (see trustedDomains.ts) - warns that this leaves Matrix for an arbitrary
 * external site, with an opt-in "Trust <domain>" toggle so repeat visits to the same site don't
 * need re-confirming, without silently trusting anything by default. BaseDialog already gives this
 * the X close button and click-outside-to-close behavior every other dialog gets, for free.
 */

import React, { useState, type JSX } from "react";

import BaseDialog from "../../../../element-web/apps/web/src/components/views/dialogs/BaseDialog";
import DialogButtons from "../../../../element-web/apps/web/src/components/views/elements/DialogButtons";
import ToggleSwitch from "../../../../element-web/apps/web/src/components/views/elements/ToggleSwitch";
import { trustDomain } from "../../framework/trustedDomains";

interface Props {
    url: string;
    domain: string;
    onFinished: (openLink?: boolean) => void;
}

export function ExternalHandleLinkWarningDialog({ url, domain, onFinished }: Props): JSX.Element {
    const [trust, setTrust] = useState(false);

    const onOpen = (): void => {
        if (trust) trustDomain(domain);
        onFinished(true);
    };

    return (
        <BaseDialog
            className="social_ExternalHandleLinkWarningDialog"
            onFinished={() => onFinished(false)}
            title="You're about to open an external link"
        >
            <p className="social_ExternalHandleLinkWarningDialog_warning">
                Only open sites you trust - this link leads outside Matrix.
            </p>
            <p className="social_ExternalHandleLinkWarningDialog_link">
                <a href={url} target="_blank" rel="noreferrer noopener" onClick={(e) => e.preventDefault()}>
                    {url}
                </a>
            </p>
            <label className="social_ExternalHandleLinkWarningDialog_trustRow">
                <span>Trust {domain}</span>
                <ToggleSwitch checked={trust} onChange={setTrust} />
            </label>
            <DialogButtons
                primaryButton="Open"
                onPrimaryButtonClick={onOpen}
                cancelButton="Cancel"
                onCancel={() => onFinished(false)}
            />
        </BaseDialog>
    );
}

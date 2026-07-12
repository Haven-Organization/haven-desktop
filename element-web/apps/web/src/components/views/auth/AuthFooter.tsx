/*
Copyright 2019-2024 New Vector Ltd.
Copyright 2019 The Matrix.org Foundation C.I.C.
Copyright 2015, 2016 OpenMarket Ltd

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, type ReactElement } from "react";

import SdkConfig from "../../../SdkConfig";
import { _t } from "../../../languageHandler";

const AuthFooter = (): ReactElement => {
    const brandingConfig = SdkConfig.getObject("branding");
    // "Powered by Matrix" is folded into the same default-fallback array as the GitHub link,
    // rather than being a separate, always-rendered fixture below it - otherwise setting
    // auth_footer_links to [] (per this option's own documented purpose - see setup.sh's own
    // comment on it - "remove them entirely") would still leave this one link behind regardless,
    // which isn't what a host asking for zero footer links wants.
    const links = brandingConfig?.get("auth_footer_links") ?? [
        { text: "GitHub", url: "https://github.com/Haven-Organization/haven-desktop" },
        { text: _t("powered_by_matrix"), url: "https://matrix.org" },
    ];

    const authFooterLinks: JSX.Element[] = [];
    for (const linkEntry of links) {
        authFooterLinks.push(
            <a href={linkEntry.url} key={linkEntry.text} target="_blank" rel="noreferrer noopener">
                {linkEntry.text}
            </a>,
        );
    }

    return (
        <footer className="mx_AuthFooter" role="contentinfo">
            {authFooterLinks}
        </footer>
    );
};

export default AuthFooter;

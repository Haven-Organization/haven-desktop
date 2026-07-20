/*
 * Social Overlay — openExternalHandleLink
 *
 * Single choke point for opening an MSC4503 external handle's link, from either the RightPanel or
 * a profile room (see ExternalHandleBadge.tsx, used by both) - checks the per-device trusted-domain
 * list first (trustedDomains.ts) and only prompts with ExternalHandleLinkWarningDialog when the
 * domain hasn't been trusted yet.
 */

import Modal from "../../../../element-web/apps/web/src/Modal";
import { isDomainTrusted } from "../../framework/trustedDomains";
import { ExternalHandleLinkWarningDialog } from "../components/ExternalHandleLinkWarningDialog";

function openInNewTab(url: string): void {
    window.open(url, "_blank", "noreferrer,noopener");
}

export function openExternalHandleLink(url: string): void {
    let domain: string;
    try {
        domain = new URL(url).hostname;
    } catch {
        return; // malformed URL from a misbehaving bridge - nothing sensible to open
    }

    if (isDomainTrusted(domain)) {
        openInNewTab(url);
        return;
    }

    const { finished } = Modal.createDialog(ExternalHandleLinkWarningDialog, { url, domain });
    finished.then(([openLink]: [boolean?]) => {
        if (openLink) openInNewTab(url);
    });
}

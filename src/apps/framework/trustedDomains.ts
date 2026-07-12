/*
 * Haven — per-device trusted-domain storage
 *
 * Backs the "you're about to open <link>" confirmation modal for MSC4503 external handle links.
 * Deliberately a plain localStorage key, not a SettingsStore SettingLevel.DEVICE setting - the
 * DEVICE level's own storage (mx_local_settings) is a *persistent* device-preferences bucket that
 * survives logout by design (theme, layout, etc.), whereas this needs to reset on sign-out/sign-in
 * like Discord's per-device trusted-domains list. Element's own Lifecycle.clearStorage() already
 * calls `localStorage.clear()` on every logout, so a plain key here gets wiped for free with no
 * extra plumbing - a fresh sign-in (this device or another) always starts with nothing trusted.
 */

const STORAGE_KEY = "haven_trusted_external_domains";

function readTrustedDomains(): Set<string> {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(parsed) ? parsed.filter((d): d is string => typeof d === "string") : []);
    } catch {
        return new Set();
    }
}

export function isDomainTrusted(domain: string): boolean {
    return readTrustedDomains().has(domain.toLowerCase());
}

export function trustDomain(domain: string): void {
    const domains = readTrustedDomains();
    domains.add(domain.toLowerCase());
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(domains)));
    } catch {
        // localStorage unavailable/full - the confirmation modal will just reappear next click,
        // not worth surfacing an error for.
    }
}

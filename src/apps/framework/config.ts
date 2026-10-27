import SdkConfig from "../../../element-web/apps/web/src/SdkConfig";

/**
 * Shape of Haven's own "haven" config.json block — kept out of stock Element's IConfigOptions
 * schema entirely (see README's Configuration section for why), so this is read via an untyped
 * escape hatch rather than SdkConfig's normal typed accessor.
 */
interface HavenAppsConfig {
    /** Master switch: false disables every app regardless of any per-app entry below. */
    enabled?: boolean;
    /** Per-app override, keyed by the app's own stable id (HavenApp.id, e.g. "social"). */
    [appId: string]: { enabled?: boolean } | boolean | undefined;
}

export type BlockquoteStyle = "stock" | "greentext";

interface HavenConfig {
    apps?: HavenAppsConfig;
    /** How a message line starting with "> " renders. Defaults to stock Element's own normal
     * blockquote if absent/unrecognized — "greentext" opts into the imageboard-style green,
     * unboxed rendering instead (see socialSlashCommands.ts's toGreentextHTML). */
    blockquote_style?: BlockquoteStyle;
    /**
     * Where webxdc and Flash games run in the web app: a site of its own (not Haven's) serving the
     * files in webapp/webxdc-sandbox/. "{id}" in it is replaced by each game's own id, to give every
     * game a hostname of its own. Without it, games run in the sandbox bundled with Haven. The
     * desktop app has its own sandbox and ignores this.
     */
    webxdc_sandbox_url?: string;
}

function getHavenConfig(): HavenConfig {
    return (SdkConfig.get() as unknown as { haven?: HavenConfig }).haven ?? {};
}

/** Whether the given Haven app id should be available at all, per the "haven.apps" config block. */
export function isAppEnabled(appId: string): boolean {
    const apps = getHavenConfig().apps;
    if (!apps) return true;
    if (apps.enabled === false) return false;

    const perApp = apps[appId];
    if (typeof perApp === "object" && perApp !== null) {
        return perApp.enabled !== false;
    }
    return true;
}

/** Per the "haven.webxdc_sandbox_url" config value, or undefined when it isn't set. */
export function getWebxdcSandboxUrl(): string | undefined {
    const url = getHavenConfig().webxdc_sandbox_url;
    return typeof url === "string" && url ? url : undefined;
}

/** Per the "haven.blockquote_style" config value — defaults to "stock" if absent/unrecognized. */
export function getBlockquoteStyle(): BlockquoteStyle {
    return getHavenConfig().blockquote_style === "greentext" ? "greentext" : "stock";
}

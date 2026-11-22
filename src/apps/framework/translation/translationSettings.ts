/*
 * Haven - message translation: which translation site to use and which language to translate
 * into, from the user's settings (Settings > Preferences > Translation) and the host's config.
 */

import SettingsStore from "../../../../element-web/apps/web/src/settings/SettingsStore";
import { useSettingValue } from "../../../../element-web/apps/web/src/hooks/useSettings";
import { getHostTranslationConfig, isTranslationAllowedByHost } from "../config";
import { type DetectedLanguage } from "./detectLanguage";
import { getReadableLanguages, getTargetLanguage } from "./languages";
import {
    BUILT_IN_SERVICES,
    DEFAULT_SERVICE_ID,
    parseHostService,
    SERVICE_OFF,
    type TranslationService,
} from "./services";

/** The sites a user can pick: the built-in ones, then any the host adds. */
export function getAvailableServices(): TranslationService[] {
    const services = [...BUILT_IN_SERVICES];
    getHostTranslationConfig().services.forEach((value, index) => {
        const service = parseHostService(value, index);
        if (service && !services.some((s) => s.id === service.id)) services.push(service);
    });
    return services;
}

/** The site used until the user picks one: the host's "default_service", or LibreTranslate. */
export function getHostDefaultServiceId(): string {
    const chosen = getHostTranslationConfig().defaultService;
    if (chosen === SERVICE_OFF) return SERVICE_OFF;
    return chosen && getAvailableServices().some((s) => s.id === chosen) ? chosen : DEFAULT_SERVICE_ID;
}

/**
 * The site messages are translated with, or undefined when translation is off (by the user or the
 * host). A choice that's no longer available (a host site since removed) falls back to the host's
 * default.
 */
export function getTranslationService(chosen?: string | null): TranslationService | undefined {
    if (!isTranslationAllowedByHost()) return undefined;
    const own = chosen === undefined ? SettingsStore.getValue("Haven.translationService") : chosen;
    const services = getAvailableServices();
    const id = typeof own === "string" && (own === SERVICE_OFF || services.some((s) => s.id === own)) ? own : null;
    const resolved = id ?? getHostDefaultServiceId();
    if (resolved === SERVICE_OFF) return undefined;
    return services.find((s) => s.id === resolved);
}

/** getTranslationService and getTargetLanguage, kept up to date with the settings. */
export function useTranslationSettings(): { service: TranslationService | undefined; target: string } {
    const serviceSetting = useSettingValue("Haven.translationService");
    const targetSetting = useSettingValue("Haven.translationTargetLanguage");
    return { service: getTranslationService(serviceSetting), target: getTargetLanguage(targetSetting) };
}

/** Whether a message detected as being in `detected` is in a language the user doesn't read. */
export function isForeign(detected: DetectedLanguage | undefined, target: string): detected is DetectedLanguage {
    return !!detected && !getReadableLanguages(target).has(detected.language);
}

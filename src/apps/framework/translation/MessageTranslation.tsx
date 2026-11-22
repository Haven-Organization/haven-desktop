/*
 * Haven - message translation: "Translate with <site>" under a message's text, in the room
 * timeline and in Social, for a message confidently detected as being in a language the user
 * doesn't read. It opens the site (see services.ts) in a new tab with the message's text. The
 * message's options menu offers the same for any message not clearly in a language they read.
 */

import React, { type JSX, useEffect, useMemo, useState } from "react";
import { EventType, type MatrixEvent, MsgType } from "matrix-js-sdk/src/matrix";

import { getParentEventId, stripPlainReply } from "../../../../element-web/apps/web/src/utils/Reply";

import { detectLanguage, getLoadedDetector, loadDetector } from "./detectLanguage";
import { getReadableLanguages, getTargetLanguage, languageName } from "./languages";
import { translationLink, type TranslationService } from "./services";
import { getTranslationService, isForeign, useTranslationSettings } from "./translationSettings";

/** The detector for Latin, Cyrillic and other shared scripts, loaded on first use. */
function useDetector(enabled: boolean): ReturnType<typeof getLoadedDetector> {
    const [detector, setDetector] = useState(getLoadedDetector);
    useEffect(() => {
        if (!enabled || detector) return;
        let cancelled = false;
        void loadDetector().then((loaded) => {
            if (!cancelled) setDetector(() => loaded);
        });
        return () => {
            cancelled = true;
        };
    }, [enabled, detector]);
    return detector;
}

/** "Translate with <site>". */
export function translateLabel(service: TranslationService): string {
    return `Translate with ${service.name}`;
}

/** What the link does, as its tooltip. */
function linkTitle(service: TranslationService, target: string, truncated: boolean): string {
    const into = `Opens ${service.name} with this message's text, to translate it into ${languageName(target)}.`;
    return truncated ? `${into} The message is too long to send whole: only its start is sent.` : into;
}

interface Props {
    /** The message's text, as plain text. */
    text: string;
}

export function MessageTranslation({ text }: Props): JSX.Element | null {
    const { service, target } = useTranslationSettings();
    const detector = useDetector(!!service);
    const detected = useMemo(
        () => (service ? detectLanguage(text, getReadableLanguages(target), detector) : undefined),
        [service, target, text, detector],
    );
    const link = useMemo(
        () =>
            service && detected?.confident && isForeign(detected, target)
                ? translationLink(service, text, target, detected.language)
                : undefined,
        [service, detected, target, text],
    );

    if (!service || !link || !detected) return null;
    return (
        <a
            className="haven_Translation_button"
            href={link.url}
            target="_blank"
            rel="noreferrer noopener"
            title={linkTitle(service, target, link.truncated)}
            onClick={(e) => e.stopPropagation()}
        >
            {translateLabel(service)}
        </a>
    );
}

/**
 * Whether the message's options menu should offer translating `text`: when translation is on and
 * the text isn't clearly in a language the user reads. Without the shared-script detector loaded
 * yet, Latin and similar text is offered too.
 */
export function getMenuTranslationService(text: string): TranslationService | undefined {
    const service = getTranslationService();
    if (!service || !text.trim()) return undefined;
    void loadDetector(); // So the language is known by the time "Translate with ..." is clicked.
    const detected = detectLanguage(text, getReadableLanguages());
    if (detected?.confident && !isForeign(detected, getTargetLanguage())) return undefined;
    return service;
}

/** Opens `text` in `service`, in a new tab (the system browser, in the desktop app). */
export function openTranslation(service: TranslationService, text: string): void {
    const target = getTargetLanguage();
    const source = detectLanguage(text, getReadableLanguages(target))?.language;
    window.open(translationLink(service, text, target, source).url, "_blank", "noopener,noreferrer");
}

/**
 * A room message's text to translate: its (latest edit's) body, without the quoted text of the
 * message it replies to. Undefined for anything that isn't a text, notice or emote message.
 */
export function getTranslatableText(event: MatrixEvent): string | undefined {
    if (event.getType() !== EventType.RoomMessage || event.isRedacted()) return undefined;
    const content = event.getContent();
    if (![MsgType.Text, MsgType.Notice, MsgType.Emote].includes(content.msgtype as MsgType)) return undefined;
    if (typeof content.body !== "string") return undefined;
    // As the timeline shows it (TextualBodyFactory's stripReply).
    const stripReply = !event.replacingEvent() && !!getParentEventId(event);
    return stripReply ? stripPlainReply(content.body) : content.body;
}

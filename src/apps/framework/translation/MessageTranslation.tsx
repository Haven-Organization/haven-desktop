/*
 * Haven - message translation: "Translate with <site>" under a message's text, in the room
 * timeline and in Social, for a message confidently detected as being in a language the user
 * doesn't read. It opens the site (see services.ts) in a new tab with the message's text. The
 * message's options menu offers the same for any message not clearly in a language they read.
 */

import React, { type JSX, useEffect, useMemo, useState } from "react";
import { EventType, type MatrixEvent, MsgType } from "matrix-js-sdk/src/matrix";

import { getParentEventId, stripPlainReply } from "../../../../element-web/apps/web/src/utils/Reply";
import { MatrixClientPeg } from "../../../../element-web/apps/web/src/MatrixClientPeg";

import { detectForeignText, detectLanguage, getLoadedDetector, loadDetector } from "./detectLanguage";
import { getReadableLanguages, getTargetLanguage, languageName } from "./languages";
import { mentionsAsNames } from "./mentionNames";
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
function linkTitle(service: TranslationService, target: string, truncated: boolean, partial: boolean): string {
    const what = partial ? "the lines of this message that aren't" : "this message's text, to translate it";
    const into = partial
        ? `Opens ${service.name} with ${what} in ${languageName(target)}, to translate them.`
        : `Opens ${service.name} with ${what} into ${languageName(target)}.`;
    return truncated ? `${into} The message is too long to send whole: only its start is sent.` : into;
}

interface Props {
    /** The message's text, as plain text. */
    text: string;
}

export function MessageTranslation({ text }: Props): JSX.Element | null {
    const { service, target } = useTranslationSettings();
    const detector = useDetector(!!service);
    const foreign = useMemo(
        () => (service ? detectForeignText(text, getReadableLanguages(target), detector) : undefined),
        [service, target, text, detector],
    );
    const link = useMemo(
        () => (service && foreign ? translationLink(service, foreign.text, target, foreign.language) : undefined),
        [service, foreign, target],
    );

    if (!service || !link || !foreign) return null;
    return (
        <a
            className="haven_Translation_button"
            href={link.url}
            target="_blank"
            rel="noreferrer noopener"
            title={linkTitle(service, target, link.truncated, foreign.partial)}
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
    const readable = getReadableLanguages();
    const detected = detectLanguage(text, readable);
    if (detected?.confident && !isForeign(detected, getTargetLanguage()) && !detectForeignText(text, readable)) {
        return undefined;
    }
    return service;
}

/** Opens `text` in `service`, in a new tab (the system browser, in the desktop app). */
export function openTranslation(service: TranslationService, text: string): void {
    const target = getTargetLanguage();
    const readable = getReadableLanguages(target);
    // Only the foreign lines, when the rest is in a language the user reads (see detectForeignText).
    const foreign = detectForeignText(text, readable);
    const source = foreign?.language ?? detectLanguage(text, readable)?.language;
    window.open(translationLink(service, foreign?.text ?? text, target, source).url, "_blank", "noopener,noreferrer");
}

/**
 * A room message's text to translate: its (latest edit's) body, without the quoted text of the
 * message it replies to, and with mentions as names (see mentionNames.ts). Undefined for anything
 * that isn't a text, notice or emote message.
 */
export function getTranslatableText(event: MatrixEvent): string | undefined {
    if (event.getType() !== EventType.RoomMessage || event.isRedacted()) return undefined;
    const content = event.getContent();
    if (![MsgType.Text, MsgType.Notice, MsgType.Emote].includes(content.msgtype as MsgType)) return undefined;
    if (typeof content.body !== "string") return undefined;
    // As the timeline shows it (TextualBodyFactory's stripReply).
    const stripReply = !event.replacingEvent() && !!getParentEventId(event);
    const body = stripReply ? stripPlainReply(content.body) : content.body;
    return mentionsAsNames(body, MatrixClientPeg.get()?.getRoom(event.getRoomId()));
}

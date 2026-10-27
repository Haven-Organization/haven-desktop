/*
 * Haven: a webxdc game shared as a file, playable where it's posted: in a room's timeline
 * (WebxdcBody) and in Social posts. A Flash game (.swf) plays here too when the build has Ruffle,
 * packaged as a webxdc game (see utils/flash.ts).
 *
 * Shows a cover with the game's icon and name until Play is clicked, then runs the game in its
 * sandbox (see utils/webxdc.ts and res/webxdc-sandbox/). Nothing of the game runs before that.
 */

import React, {
    type JSX,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
} from "react";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";
import { Button, Tooltip } from "@vector-im/compound-web";
import PlayIcon from "@vector-im/compound-design-tokens/assets/web/icons/play-solid";
import CloseIcon from "@vector-im/compound-design-tokens/assets/web/icons/close";
import ExpandIcon from "@vector-im/compound-design-tokens/assets/web/icons/expand";
import DownloadIcon from "@vector-im/compound-design-tokens/assets/web/icons/download";
import PopOutIcon from "@vector-im/compound-design-tokens/assets/web/icons/pop-out";
import classNames from "classnames";

import { _t } from "../../../languageHandler";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { useMediaVisible } from "../../../hooks/useMediaVisible";
import { MediaEventHelper } from "../../../utils/MediaEventHelper";
import Modal from "../../../Modal";
import InfoDialog from "../dialogs/InfoDialog";
import {
    readWebxdcArchive,
    readWebxdcCover,
    type WebxdcArchive,
    type WebxdcCover,
    webxdcGameId,
    type WebxdcRangeFetcher,
    type WebxdcSandbox,
    webxdcSandbox,
} from "../../../utils/webxdc";
import { WebxdcSession, type WebxdcSessionProblem } from "../../../utils/WebxdcSession";
import { FlashPlayerError, isFlashFile, readFlashArchive } from "../../../utils/flash";
import { WEBXDC_IFRAME_ALLOW, webxdcFrameSandbox, WebxdcPopoutStore } from "../../../utils/WebxdcPopoutStore";
import { WebxdcCartridge } from "./WebxdcCartridge";
import { PopInIcon, SaveGameIcon } from "./WebxdcIcons";

/** Games this small are read whole for their name and icon before Play; bigger ones in part. */
const COVER_READ_MAX_SIZE = 5 * 1024 * 1024;

/**
 * Covers read in part, by mxc URI. Only ones that were read: a read can fail for a while, such as
 * when Haven's service worker, which signs media requests, hasn't taken over the page yet.
 */
const coverCache = new Map<string, WebxdcCover>();

/** Calls `retry` once when a service worker takes over a page it didn't control yet. */
function retryWhenServiceWorkerReady(retry: () => void): () => void {
    const container = navigator.serviceWorker;
    if (!container || container.controller) return () => {};
    container.addEventListener("controllerchange", retry, { once: true });
    return () => container.removeEventListener("controllerchange", retry);
}

/** Fetches part of a file, or null when the server sends whole files only. */
function rangeFetcher(url: string): WebxdcRangeFetcher {
    return async (start, end) => {
        const controller = new AbortController();
        const response = await fetch(url, {
            headers: { Range: `bytes=${start}-${end - 1}` },
            signal: controller.signal,
        });
        if (response.status !== 206) {
            controller.abort(); // don't download the whole file
            return null;
        }
        return response.arrayBuffer();
    };
}

type ArchiveState =
    | { kind: "none" }
    | { kind: "loading" }
    | { kind: "ready"; archive: WebxdcArchive; iconUrl?: string }
    | { kind: "failed"; reason: "download" | "invalid" | "player" };

/** Why a game stopped, as one or two paragraphs. */
function problemText(problem: WebxdcSessionProblem): string[] {
    switch (problem.kind) {
        case "left_sandbox":
            return [_t("timeline|webxdc|left_sandbox")];
        case "needs_sandbox": {
            const reasons = {
                indexeddb: _t("timeline|webxdc|needs_sandbox_indexeddb"),
                pages: _t("timeline|webxdc|needs_sandbox_pages"),
                other: _t("timeline|webxdc|needs_sandbox_other"),
            };
            return [reasons[problem.what], _t("timeline|webxdc|needs_sandbox_fix")];
        }
        case "failed":
            return [problem.message ?? _t("timeline|webxdc|failed")];
    }
}

/** How long "Saved" (or why it wasn't) shows on a Save button. */
const SAVE_RESULT_MS = 2500;

/** A Save button's label and click handler, for saving a game now. */
function useSaveButton(save: () => Promise<boolean>): { label: string; busy: boolean; onClick: () => Promise<void> } {
    const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    useEffect(() => {
        if (state !== "saved" && state !== "failed") return;
        const timer = setTimeout(() => setState("idle"), SAVE_RESULT_MS);
        return () => clearTimeout(timer);
    }, [state]);
    const onClick = useCallback(async () => {
        setState("saving");
        const kept = await save();
        if (mounted.current) setState(kept ? "saved" : "failed");
    }, [save]);
    const labels = {
        idle: _t("timeline|webxdc|save"),
        saving: _t("timeline|webxdc|saving"),
        saved: _t("timeline|webxdc|saved"),
        failed: _t("timeline|webxdc|save_failed"),
    };
    return { label: labels[state], busy: state === "saving", onClick };
}

function fileNameOf(event: MatrixEvent): string {
    const content = event.getContent();
    return String(content.filename ?? content.body ?? "");
}

/** A name to show before the game's own manifest has been read. */
function fallbackName(event: MatrixEvent): string {
    return (
        fileNameOf(event)
            .replace(/\.(xdc|swf)$/i, "")
            .trim() || _t("timeline|webxdc|game")
    );
}

interface Props {
    mxEvent: MatrixEvent;
    /** The timeline's helper for the event's file, when there is one to share. */
    mediaEventHelper?: MediaEventHelper;
    className?: string;
}

export function WebxdcGame({ mxEvent, mediaEventHelper, className }: Props): JSX.Element {
    const [mediaVisible] = useMediaVisible(mxEvent);
    const ownHelper = useMemo(
        () => (mediaEventHelper ? undefined : new MediaEventHelper(mxEvent)),
        [mediaEventHelper, mxEvent],
    );
    useEffect(() => () => ownHelper?.destroy(), [ownHelper]);
    const helper = mediaEventHelper ?? ownHelper!;
    const flash = useMemo(() => isFlashFile(mxEvent.getContent()), [mxEvent]);

    const [archiveState, setArchiveState] = useState<ArchiveState>({
        kind: "none",
    });
    const [playing, setPlaying] = useState(false);
    const [gameId, setGameId] = useState<string>();

    useEffect(() => {
        let canceled = false;
        void webxdcGameId(mxEvent.getRoomId()!, mxEvent.getId()!).then((id) => !canceled && setGameId(id));
        return () => {
            canceled = true;
        };
    }, [mxEvent]);
    const sandbox = useMemo(() => (gameId ? webxdcSandbox(gameId) : undefined), [gameId]);
    /** Why a popped-out game stopped, shown on the card it came from. */
    const [popOutProblem, setPopOutProblem] = useState<WebxdcSessionProblem>();

    // A game popped out into its own window keeps running there, even with this card gone.
    const client = useMatrixClientContext();
    const popouts = WebxdcPopoutStore.instance;
    const eventId = mxEvent.getId()!;
    const poppedOut = useSyncExternalStore(
        useCallback((listener: () => void) => popouts.subscribe(listener), [popouts]),
        () => popouts.isPoppedOut(eventId),
    );

    const loadingRef = useRef<Promise<WebxdcArchive | undefined>>(undefined);
    const downloadFailed = useRef(false);
    const loadArchive = useCallback((): Promise<WebxdcArchive | undefined> => {
        loadingRef.current ??= (async () => {
            setArchiveState({ kind: "loading" });
            let blob: Blob;
            // A failed download stays failed in the helper, so a retry downloads afresh.
            const source = downloadFailed.current ? new MediaEventHelper(mxEvent) : helper;
            try {
                blob = await source.sourceBlob.value;
            } catch (e) {
                downloadFailed.current = true;
                logger.warn("webxdc: could not download the game", e);
                setArchiveState({ kind: "failed", reason: "download" });
                loadingRef.current = undefined; // let Play try again
                return undefined;
            }
            try {
                const archive = flash
                    ? await readFlashArchive(blob, fallbackName(mxEvent))
                    : await readWebxdcArchive(blob);
                const iconUrl = archive.icon ? URL.createObjectURL(archive.icon) : undefined;
                setArchiveState({ kind: "ready", archive, iconUrl });
                return archive;
            } catch (e) {
                if (e instanceof FlashPlayerError) {
                    logger.warn("webxdc: could not load Ruffle for a Flash game", e);
                    setArchiveState({ kind: "failed", reason: "player" });
                    loadingRef.current = undefined; // let Play try again
                    return undefined;
                }
                logger.warn("webxdc: could not open the game", e);
                setArchiveState({ kind: "failed", reason: "invalid" });
                return undefined;
            }
        })();
        return loadingRef.current;
    }, [flash, helper, mxEvent]);

    const archiveIconUrl = archiveState.kind === "ready" ? archiveState.iconUrl : undefined;
    useEffect(() => () => (archiveIconUrl ? URL.revokeObjectURL(archiveIconUrl) : undefined), [archiveIconUrl]);

    // Small games show their own name and icon on the cover, when media shows here at all. A Flash
    // movie has neither, so it's only fetched to play.
    const size = mxEvent.getContent().info?.size;
    useEffect(() => {
        if (!flash && mediaVisible && typeof size === "number" && size <= COVER_READ_MAX_SIZE) void loadArchive();
    }, [flash, mediaVisible, size, loadArchive]);

    // Bigger ones are read in part: just enough for their name and icon (see readWebxdcCover).
    // Not for an encrypted file, which can only be read whole.
    const mxc: string | undefined = mxEvent.getContent().file || flash ? undefined : mxEvent.getContent().url;
    const [cover, setCover] = useState<WebxdcCover | null>(() => (mxc && coverCache.get(mxc)) || null);
    const [coverAttempt, setCoverAttempt] = useState(0);
    useEffect(() => {
        if (!mediaVisible || !mxc || typeof size !== "number" || size <= COVER_READ_MAX_SIZE) return;
        const cached = coverCache.get(mxc);
        if (cached) {
            setCover(cached);
            return;
        }
        const url = client.mxcUrlToHttp(mxc);
        if (!url) return;
        let canceled = false;
        let stopWaiting = (): void => {};
        void readWebxdcCover(rangeFetcher(url), size)
            .catch((e) => {
                logger.info("webxdc: could not read the game's cover", e);
                return null;
            })
            .then((read) => {
                if (canceled) return;
                if (read) coverCache.set(mxc, read);
                else stopWaiting = retryWhenServiceWorkerReady(() => setCoverAttempt((n) => n + 1));
                setCover(read);
            });
        return () => {
            canceled = true;
            stopWaiting();
        };
    }, [client, mediaVisible, mxc, size, coverAttempt]);
    const coverIconUrl = useMemo(() => (cover?.icon ? URL.createObjectURL(cover.icon) : undefined), [cover]);
    useEffect(() => () => (coverIconUrl ? URL.revokeObjectURL(coverIconUrl) : undefined), [coverIconUrl]);

    const iconUrl = archiveIconUrl ?? coverIconUrl;
    const name =
        (archiveState.kind === "ready" && archiveState.archive.manifest.name) ||
        cover?.manifest.name ||
        fallbackName(mxEvent);

    const [playRequested, setPlayRequested] = useState(false);
    const onPlay = useCallback(async () => {
        setPlayRequested(true);
        const archive = await loadArchive();
        setPlayRequested(false);
        if (archive) setPlaying(true);
    }, [loadArchive]);

    const [downloadUrl, setDownloadUrl] = useState<string>();
    useEffect(() => () => (downloadUrl ? URL.revokeObjectURL(downloadUrl) : undefined), [downloadUrl]);
    const onDownload = useCallback(async () => {
        const url = URL.createObjectURL(await helper.sourceBlob.value);
        setDownloadUrl(url);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileNameOf(mxEvent) || (flash ? "game.swf" : "game.xdc");
        link.click();
    }, [flash, helper, mxEvent]);

    /** The game playing here is handing over its save to the window it's popping out to. */
    const [handingOver, setHandingOver] = useState(false);

    // Must run straight from the click, or popup blockers refuse the window. `handover` is the game
    // that's playing here handing over its save; it stays until it has.
    const onPopOut = (handover?: Promise<unknown>): void => {
        if (!sandbox) return;
        setPopOutProblem(undefined);
        const opened = popouts.popOut({
            client,
            roomId: mxEvent.getRoomId()!,
            eventId,
            // Straight from the cartridge, the game is downloaded while the window opens.
            archive: archiveState.kind === "ready" ? archiveState.archive : loadArchive(),
            sandbox,
            name,
            onFailed: () => {
                showPopOutRefused();
                setPlaying(true);
            },
            onProblem: setPopOutProblem,
        });
        if (!opened) {
            showPopOutRefused();
        } else if (handover) {
            setHandingOver(true);
            void handover.finally(() => {
                setHandingOver(false);
                setPlaying(false);
            });
        } else {
            setPlaying(false);
        }
    };
    const [bringingBack, setBringingBack] = useState(false);
    const onPopIn = async (): Promise<void> => {
        setBringingBack(true);
        await popouts.bringBack(eventId);
        setBringingBack(false);
        setPlaying(true);
    };
    const savePoppedOut = useSaveButton(useCallback(() => popouts.saveNow(eventId), [popouts, eventId]));

    if (playing && (!poppedOut || handingOver) && archiveState.kind === "ready" && sandbox) {
        return (
            <WebxdcPlayer
                mxEvent={mxEvent}
                archive={archiveState.archive}
                sandbox={sandbox}
                name={name}
                onClose={() => setPlaying(false)}
                onPopOut={onPopOut}
                className={className}
            />
        );
    }

    const canPlay = !!sandbox && !(archiveState.kind === "failed" && archiveState.reason === "invalid");
    const content = mxEvent.getContent();
    const cartridge = <WebxdcCartridge colorSeed={content.file?.url ?? content.url} iconUrl={iconUrl} title={name} />;

    let note: string | undefined;
    if (poppedOut) note = _t("timeline|webxdc|popped_out");
    else if (archiveState.kind === "failed") {
        const notes = {
            download: _t("timeline|webxdc|download_failed"),
            invalid: _t("timeline|webxdc|not_a_game"),
            player: _t("timeline|webxdc|player_failed"),
        };
        note = notes[archiveState.reason];
    } else if (popOutProblem) note = problemText(popOutProblem).join(" ");

    return (
        <div className={classNames("mx_WebxdcGame", className)}>
            {canPlay ? (
                <button
                    type="button"
                    className="mx_WebxdcGame_cartridge"
                    onClick={poppedOut ? () => popouts.focus(eventId) : onPlay}
                    disabled={archiveState.kind === "loading"}
                    aria-label={_t("timeline|webxdc|play_game", { name })}
                >
                    {cartridge}
                </button>
            ) : (
                <div className="mx_WebxdcGame_cartridge">{cartridge}</div>
            )}
            <div className="mx_WebxdcGame_footer">
                <div className="mx_WebxdcGame_details">
                    <div className="mx_WebxdcGame_name" title={name}>
                        🎮 {name}
                    </div>
                    <div className="mx_WebxdcGame_kind">
                        {flash ? _t("timeline|webxdc|kind_flash") : _t("timeline|webxdc|kind")}
                    </div>
                </div>
                <div className="mx_WebxdcGame_buttons">
                    {poppedOut && (
                        <>
                            <Tooltip description={_t("timeline|webxdc|pop_in_tooltip")}>
                                <Button
                                    kind="primary"
                                    size="md"
                                    Icon={PopInIcon}
                                    disabled={bringingBack}
                                    onClick={onPopIn}
                                >
                                    {_t("timeline|webxdc|pop_in")}
                                </Button>
                            </Tooltip>
                            <Tooltip description={_t("timeline|webxdc|save_tooltip")}>
                                <Button
                                    kind="secondary"
                                    size="md"
                                    Icon={SaveGameIcon}
                                    disabled={savePoppedOut.busy || bringingBack}
                                    onClick={savePoppedOut.onClick}
                                >
                                    {savePoppedOut.label}
                                </Button>
                            </Tooltip>
                        </>
                    )}
                    {canPlay && !poppedOut && (
                        <Tooltip description={_t("timeline|webxdc|play_tooltip")}>
                            <Button
                                kind="primary"
                                size="md"
                                Icon={PlayIcon}
                                disabled={archiveState.kind === "loading"}
                                onClick={onPlay}
                            >
                                {playRequested ? _t("timeline|webxdc|loading") : _t("timeline|webxdc|play")}
                            </Button>
                        </Tooltip>
                    )}
                    {canPlay && !poppedOut && (
                        <Tooltip label={_t("timeline|webxdc|pop_out")} caption={_t("timeline|webxdc|pop_out_tooltip")}>
                            <Button
                                kind="secondary"
                                size="md"
                                Icon={PopOutIcon}
                                iconOnly
                                aria-label={_t("timeline|webxdc|pop_out")}
                                disabled={archiveState.kind === "loading" && playRequested}
                                onClick={() => onPopOut()}
                            />
                        </Tooltip>
                    )}
                    <Tooltip label={_t("action|download")} caption={_t("timeline|webxdc|download_tooltip")}>
                        <Button
                            kind="secondary"
                            size="md"
                            Icon={DownloadIcon}
                            iconOnly
                            aria-label={_t("action|download")}
                            onClick={onDownload}
                        />
                    </Tooltip>
                </div>
            </div>
            {note && <div className="mx_WebxdcGame_note">{note}</div>}
        </div>
    );
}

function showPopOutRefused(): void {
    Modal.createDialog(InfoDialog, {
        title: _t("timeline|webxdc|pop_out_refused_title"),
        description: <p>{_t("timeline|webxdc|pop_out_refused")}</p>,
    });
}

interface PlayerProps {
    mxEvent: MatrixEvent;
    archive: WebxdcArchive;
    sandbox: WebxdcSandbox;
    name: string;
    onClose: () => void;
    /** Pops the game out; it hands over its save on the way (see WebxdcGame's onPopOut). */
    onPopOut: (handover: Promise<unknown>) => void;
    className?: string;
}

function WebxdcPlayer({ mxEvent, archive, sandbox, name, onClose, onPopOut, className }: PlayerProps): JSX.Element {
    const client = useMatrixClientContext();
    const roomId = mxEvent.getRoomId()!;
    const eventId = mxEvent.getId()!;

    const frameRef = useRef<HTMLIFrameElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const sessionRef = useRef<WebxdcSession>(undefined);
    const [problem, setProblem] = useState<WebxdcSessionProblem>();
    const [sendFailed, setSendFailed] = useState(false);

    // A layout effect, so Haven is listening before the frame can load and say it's ready. The
    // frame's address comes from the session, so it's set here too.
    useLayoutEffect(() => {
        const frame = frameRef.current;
        if (!frame) return;
        const session = new WebxdcSession({
            client,
            roomId,
            eventId,
            archive,
            sandbox,
            post: (message, targetOrigin) => frame.contentWindow?.postMessage(message, targetOrigin),
            onProblem: setProblem,
            onSendFailed: () => setSendFailed(true),
        });
        sessionRef.current = session;
        const onMessage = (event: MessageEvent): void => {
            if (event.source === frame.contentWindow) session.handleMessage(event.data);
        };
        window.addEventListener("message", onMessage);
        frame.src = session.src;
        return () => {
            window.removeEventListener("message", onMessage);
            session.stop();
            sessionRef.current = undefined;
        };
    }, [archive, client, eventId, roomId, sandbox]);

    const onFrameLoad = useCallback(() => sessionRef.current?.frameLoaded(), []);
    const save = useSaveButton(useCallback(() => sessionRef.current?.saveNow() ?? Promise.resolve(false), []));
    // The game hands over what it hasn't saved before it's closed or popped out.
    const [closing, setClosing] = useState(false);
    const onCloseClick = useCallback(async () => {
        setClosing(true);
        await sessionRef.current?.flush();
        onClose();
    }, [onClose]);
    const onPopOutClick = (): void => onPopOut(sessionRef.current?.flush() ?? Promise.resolve());
    const onFullscreen = useCallback(() => {
        void wrapperRef.current?.requestFullscreen?.();
    }, []);

    return (
        <div className={classNames("mx_WebxdcGame", "mx_WebxdcGame--playing", className)}>
            <div className="mx_WebxdcGame_frame" ref={wrapperRef}>
                {problem ? (
                    <div className="mx_WebxdcGame_stopped">
                        {problemText(problem).map((text) => (
                            <p key={text}>{text}</p>
                        ))}
                    </div>
                ) : (
                    <iframe
                        ref={frameRef}
                        title={name}
                        sandbox={webxdcFrameSandbox(sandbox)}
                        allow={WEBXDC_IFRAME_ALLOW}
                        referrerPolicy="no-referrer"
                        onLoad={onFrameLoad}
                    />
                )}
            </div>
            <div className="mx_WebxdcGame_bar">
                <span className="mx_WebxdcGame_barName" title={name}>
                    🎮 {name}
                </span>
                {sendFailed && <span className="mx_WebxdcGame_warning">{_t("timeline|webxdc|send_failed")}</span>}
                {!problem && (
                    <Tooltip description={_t("timeline|webxdc|save_tooltip")}>
                        <button type="button" onClick={save.onClick} disabled={save.busy || closing}>
                            <SaveGameIcon width={16} height={16} />
                            {save.label}
                        </button>
                    </Tooltip>
                )}
                <Tooltip description={_t("timeline|webxdc|pop_out_tooltip")}>
                    <button type="button" onClick={onPopOutClick} disabled={closing}>
                        <PopOutIcon width={16} height={16} />
                        {_t("timeline|webxdc|pop_out")}
                    </button>
                </Tooltip>
                <Tooltip description={_t("timeline|webxdc|fullscreen_tooltip")}>
                    <button type="button" onClick={onFullscreen}>
                        <ExpandIcon width={16} height={16} />
                        {_t("timeline|webxdc|fullscreen")}
                    </button>
                </Tooltip>
                <Tooltip description={_t("timeline|webxdc|close_tooltip")}>
                    <button type="button" onClick={onCloseClick} disabled={closing}>
                        <CloseIcon width={16} height={16} />
                        {_t("timeline|webxdc|close")}
                    </button>
                </Tooltip>
            </div>
        </div>
    );
}

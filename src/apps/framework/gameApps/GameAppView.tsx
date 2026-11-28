/*
 * Haven apps framework - a game opened as an app
 *
 * The page a game app opens: the game shared in a room's message, filling the page and playing as
 * it opens. See gameApps.ts for why it's a link to that message.
 *
 * When the game can't be played any more, the page says why instead: the message was deleted (or
 * can't be found), or the user left the room. Each offers "Remove from Apps".
 */

import React, { type JSX, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ClientEvent, type MatrixClient, type MatrixEvent, RoomEvent, SyncState } from "matrix-js-sdk/src/matrix";
import { PopOutIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import AccessibleButton from "../../../../element-web/apps/web/src/components/views/elements/AccessibleButton";
import { useMatrixClientContext } from "../../../../element-web/apps/web/src/contexts/MatrixClientContext";
import defaultDispatcher from "../../../../element-web/apps/web/src/dispatcher/dispatcher";
import { Action } from "../../../../element-web/apps/web/src/dispatcher/actions";
import { WebxdcPopoutStore } from "../../../../element-web/apps/web/src/utils/WebxdcPopoutStore";
import {
    WebxdcGame,
    type WebxdcGameControl,
} from "../../../../element-web/apps/web/src/components/views/messages/WebxdcGame";
import { AppPageOptionsMenu } from "../components/AppPageOptionsMenu";
import { gameAppId, noteGameAppOpen, useGameAppEntries, type GameAppEntry } from "./gameApps";
import { confirmRemoveFromApps } from "../removeFromApps";
import { fetchGameEvent, isGameEvent, isInRoom } from "./gameEvent";
import { GameControllerIcon } from "./GameControllerIcon";
import { popOutGameApp } from "./popOutGameApp";

type GameStatus =
    | { kind: "loading" }
    | { kind: "ready"; event: MatrixEvent }
    /** The message was deleted, or is no longer a game. */
    | { kind: "deleted" }
    /** The server didn't give us the message. */
    | { kind: "missing" }
    | { kind: "left" };

/** How long to wait before fetching the message again after a failure, doubling each time up to the last. */
const RETRY_DELAYS_MS = [2000, 4000, 8000, 16000, 30000];

/** The game's message, kept up to date as it's deleted and the user leaves or rejoins the room. */
function useGameStatus(client: MatrixClient, roomId: string, eventId: string): GameStatus {
    const [status, setStatus] = useState<GameStatus>({ kind: "loading" });
    const [attempt, setAttempt] = useState(0);
    const failures = useRef(0);

    useEffect(() => {
        let canceled = false;
        let retry: number | undefined;
        if (!isInRoom(client, roomId)) {
            setStatus({ kind: "left" });
        } else {
            fetchGameEvent(client, roomId, eventId).then(
                (event) => {
                    if (canceled) return;
                    failures.current = 0;
                    if (!event) setStatus({ kind: "missing" });
                    else setStatus(isGameEvent(event) ? { kind: "ready", event } : { kind: "deleted" });
                },
                () => {
                    // Not an answer about the message (often no connection yet, as when Haven has just
                    // started): keep loading and ask again, rather than saying the game is gone.
                    if (canceled) return;
                    const delay = RETRY_DELAYS_MS[Math.min(failures.current, RETRY_DELAYS_MS.length - 1)];
                    failures.current++;
                    retry = window.setTimeout(() => setAttempt((n) => n + 1), delay);
                },
            );
        }
        return () => {
            canceled = true;
            window.clearTimeout(retry);
        };
    }, [client, roomId, eventId, attempt]);

    // Ask again as soon as the connection to the server is back, rather than waiting out the delay.
    useEffect(() => {
        const onSync = (state: SyncState, previous: SyncState | null): void => {
            const reconnected =
                (state === SyncState.Syncing || state === SyncState.Prepared) &&
                (previous === SyncState.Error || previous === SyncState.Reconnecting || previous === null);
            if (reconnected && failures.current > 0) setAttempt((n) => n + 1);
        };
        client.on(ClientEvent.Sync, onSync);
        return () => {
            client.removeListener(ClientEvent.Sync, onSync);
        };
    }, [client]);

    useEffect(() => {
        const recheck = (): void => setAttempt((n) => n + 1);
        const onRedaction = (redaction: MatrixEvent): void => {
            if (redaction.getRoomId() === roomId && redaction.getAssociatedId() === eventId) recheck();
        };
        const onMembership = (room: { roomId: string }): void => {
            if (room.roomId === roomId) recheck();
        };
        client.on(RoomEvent.Redaction, onRedaction);
        client.on(RoomEvent.MyMembership, onMembership);
        return () => {
            client.removeListener(RoomEvent.Redaction, onRedaction);
            client.removeListener(RoomEvent.MyMembership, onMembership);
        };
    }, [client, roomId, eventId]);

    return status;
}

function Unavailable({
    status,
    entry,
    onRemove,
}: {
    status: GameStatus;
    entry: GameAppEntry;
    onRemove: () => void;
}): JSX.Element {
    const roomName = entry.room_name ?? "its room";
    let title: string;
    let text: string;
    switch (status.kind) {
        case "left":
            title = "You're not in this room";
            text = `${entry.name} was shared in ${roomName}, and you're no longer a member there.`;
            break;
        case "deleted":
            title = "This game was deleted";
            text = `The message ${entry.name} was shared in has been deleted.`;
            break;
        default:
            title = "Couldn't find this game";
            text = `The message ${entry.name} was shared in couldn't be found.`;
    }
    return (
        <div className="haven_WidgetAppView_unavailable">
            <h2>{title}</h2>
            <p>{text}</p>
            <div className="haven_WidgetAppView_unavailableButtons">
                <AccessibleButton kind="primary" onClick={onRemove}>
                    Remove from Apps
                </AccessibleButton>
            </div>
        </div>
    );
}

interface Props {
    roomId: string;
    eventId: string;
}

export function GameAppView({ roomId, eventId }: Props): JSX.Element | null {
    const client = useMatrixClientContext();
    const entry = useGameAppEntries(client).find((e) => e.room_id === roomId && e.event_id === eventId);
    const status = useGameStatus(client, roomId, eventId);
    const game = useRef<WebxdcGameControl>(null);

    const popouts = WebxdcPopoutStore.instance;
    const poppedOut = useSyncExternalStore(
        useCallback((listener: () => void) => popouts.subscribe(listener), [popouts]),
        () => popouts.isPoppedOut(eventId),
    );

    useEffect(() => {
        noteGameAppOpen(gameAppId(roomId, eventId));
        return () => noteGameAppOpen(null);
    }, [roomId, eventId]);

    // Removed from Apps on another device: nothing left to show.
    useEffect(() => {
        if (!entry) defaultDispatcher.dispatch({ action: Action.ViewHomePage });
    }, [entry]);

    const onRemove = useCallback(() => {
        void confirmRemoveFromApps(client, gameAppId(roomId, eventId), entry?.name ?? "this game");
    }, [client, roomId, eventId, entry?.name]);

    if (!entry) return null;

    const room = client.getRoom(roomId);
    const inRoom = isInRoom(client, roomId);
    const onPopOut = (): void => {
        if (poppedOut) popouts.focus(eventId);
        else if (status.kind === "ready" && game.current) game.current.popOut();
        else popOutGameApp(client, entry);
    };
    const popOutLabel = poppedOut ? "Show window" : "Pop out";

    return (
        <div className="haven_WidgetAppView haven_GameAppView">
            <div className="haven_WidgetAppView_header">
                {entry.icon ? (
                    <img className="haven_GameAppView_icon" src={entry.icon} alt="" />
                ) : (
                    <GameControllerIcon className="haven_GameAppView_icon" />
                )}
                <h1 className="haven_WidgetAppView_title" title={entry.name}>
                    {entry.name}
                </h1>
                <div className="haven_WidgetAppView_headerButtons">
                    {(status.kind === "ready" || status.kind === "loading") && (
                        <AccessibleButton
                            className="haven_WidgetAppView_headerButton"
                            title={popOutLabel}
                            aria-label={popOutLabel}
                            onClick={onPopOut}
                        >
                            <PopOutIcon width="20px" height="20px" />
                        </AccessibleButton>
                    )}
                    <AppPageOptionsMenu
                        roomId={roomId}
                        roomName={inRoom ? (room?.name ?? entry.room_name ?? null) : null}
                        eventId={eventId}
                        onRemove={onRemove}
                    />
                </div>
            </div>
            <div className="haven_WidgetAppView_body haven_GameAppView_body">
                {status.kind === "ready" ? (
                    <WebxdcGame mxEvent={status.event} appMode controlRef={game} appId={gameAppId(roomId, eventId)} />
                ) : status.kind === "loading" ? null : (
                    <Unavailable status={status} entry={entry} onRemove={onRemove} />
                )}
            </div>
        </div>
    );
}

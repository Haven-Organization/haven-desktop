/*
 * Haven apps framework - a room widget opened as an app
 *
 * The page a widget app opens: the room's widget, full-width, run in its own room (so it reads and
 * sends in that room, whichever room the user last looked at). See widgetApps.ts for why it's a
 * link to the room's widget rather than a copy.
 *
 * When the widget isn't available any more, the page says why instead:
 *  - someone else removed it from the room: who did, with "Add it back" for a user allowed to add
 *    widgets there, which restores it as it was last seen, under the same id;
 *  - the user left the room (or was removed from it);
 *  - the room was upgraded, and widgets don't move to the new room.
 * Each offers "Remove from Apps". A widget the user removed themselves is dropped from their apps
 * without asking (useWidgetAppsWatcher.ts), which closes this page.
 */

import React, { type JSX, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
    ClientEvent,
    KnownMembership,
    type MatrixClient,
    type Room,
    RoomEvent,
    RoomStateEvent,
} from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";
import { PopOutIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import AppTile from "../../../../element-web/apps/web/src/components/views/elements/AppTile";
import AccessibleButton from "../../../../element-web/apps/web/src/components/views/elements/AccessibleButton";
import WidgetAvatar from "../../../../element-web/apps/web/src/components/views/avatars/WidgetAvatar";
import Modal from "../../../../element-web/apps/web/src/Modal";
import QuestionDialog from "../../../../element-web/apps/web/src/components/views/dialogs/QuestionDialog";
import ErrorDialog from "../../../../element-web/apps/web/src/components/views/dialogs/ErrorDialog";
import { useMatrixClientContext } from "../../../../element-web/apps/web/src/contexts/MatrixClientContext";
import defaultDispatcher from "../../../../element-web/apps/web/src/dispatcher/dispatcher";
import { Action } from "../../../../element-web/apps/web/src/dispatcher/actions";
import { type ViewRoomPayload } from "../../../../element-web/apps/web/src/dispatcher/payloads/ViewRoomPayload";
import WidgetStore from "../../../../element-web/apps/web/src/stores/WidgetStore";
import { UPDATE_EVENT } from "../../../../element-web/apps/web/src/stores/AsyncStore";
import WidgetUtils from "../../../../element-web/apps/web/src/utils/WidgetUtils";
import { WidgetPopoutStore } from "../widgetPopout/WidgetPopoutStore";
import { showPopoutRefusedDialog } from "../widgetPopout/WidgetPoppedOut";
import {
    canRecreateWidget,
    noteWidgetAppOpen,
    recreateWidget,
    refreshWidgetAppEntry,
    removeWidgetApp,
    useWidgetAppEntries,
    widgetAppId,
    type WidgetAppEntry,
} from "./widgetApps";
import { widgetAppName } from "./widgetAppRegistry";
import { AppPageOptionsMenu } from "../components/AppPageOptionsMenu";

import { getWidgetAppStatus, type WidgetAppStatus } from "./widgetAppStatus";

export { getWidgetAppStatus, type WidgetAppStatus };

/** getWidgetAppStatus, kept up to date as the room, its widgets and the user's membership change. */
function useWidgetAppStatus(client: MatrixClient, roomId: string, widgetId: string): WidgetAppStatus {
    const compute = useCallback(() => getWidgetAppStatus(client, roomId, widgetId), [client, roomId, widgetId]);
    const [status, setStatus] = useState(compute);

    useEffect(() => {
        const update = (): void => setStatus(compute());
        update();
        const onWidgets = (changedRoomId?: string): void => {
            if (!changedRoomId || changedRoomId === roomId) update();
        };
        const onState = (ev: { getRoomId(): string | undefined }): void => {
            if (ev.getRoomId() === roomId) update();
        };
        const onMembership = (room: Room): void => {
            if (room.roomId === roomId) update();
        };
        WidgetStore.instance.on(UPDATE_EVENT, onWidgets);
        client.on(RoomStateEvent.Events, onState);
        client.on(RoomEvent.MyMembership, onMembership);
        client.on(ClientEvent.Room, onMembership);
        return () => {
            WidgetStore.instance.off(UPDATE_EVENT, onWidgets);
            client.removeListener(RoomStateEvent.Events, onState);
            client.removeListener(RoomEvent.MyMembership, onMembership);
            client.removeListener(ClientEvent.Room, onMembership);
        };
    }, [client, roomId, compute]);

    return status;
}

/** Keeps the stored entry in step with the widget while the room has it (refreshWidgetAppEntry). */
function useRefreshEntry(client: MatrixClient, status: WidgetAppStatus, entry: WidgetAppEntry | undefined): void {
    useEffect(() => {
        if (status.kind !== "available" || !entry) return;
        refreshWidgetAppEntry(client, status.room, entry).catch((e) => logger.warn("Couldn't update a widget app", e));
    }, [client, status, entry]);
}

function viewRoom(roomId: string): void {
    defaultDispatcher.dispatch<ViewRoomPayload>({
        action: Action.ViewRoom,
        room_id: roomId,
        metricsTrigger: undefined,
    });
}

function nameOf(room: Room | null, userId: string): string {
    return room?.getMember(userId)?.name ?? userId;
}

interface UnavailableProps {
    client: MatrixClient;
    status: Exclude<WidgetAppStatus, { kind: "available" }>;
    entry: WidgetAppEntry;
    widgetName: string;
    roomName: string;
    onRemove: () => void;
}

function Unavailable({ client, status, entry, widgetName, roomName, onRemove }: UnavailableProps): JSX.Element {
    const [busy, setBusy] = useState(false);
    const me = client.getUserId();

    const onAddBack = (): void => {
        if (status.kind !== "removed") return;
        const removedBy = status.removedBy ? nameOf(status.room, status.removedBy) : "Someone";
        const { finished } = Modal.createDialog(QuestionDialog, {
            title: "Add the widget back?",
            description: (
                <p>
                    {removedBy} removed {widgetName} from {roomName}. Adding it back puts it in the room again, for
                    everyone there, as it was before it was removed.
                </p>
            ),
            button: "Add it back",
        });
        void finished.then(async ([confirmed]: [boolean?] | []) => {
            if (!confirmed) return;
            setBusy(true);
            try {
                await recreateWidget(client, entry);
            } catch (e) {
                logger.error("Couldn't add a widget back", e);
                Modal.createDialog(ErrorDialog, {
                    title: "Couldn't add the widget back",
                    description: "You may no longer be allowed to add widgets to this room.",
                });
            } finally {
                setBusy(false);
            }
        });
    };

    let title: string;
    let text: string;
    let action: JSX.Element | null = null;
    switch (status.kind) {
        case "removed":
            if (status.removedBy && status.removedBy === me) {
                title = "You removed this widget";
                text = `You removed ${widgetName} from ${roomName}.`;
            } else {
                title = "This widget was removed";
                text = status.removedBy
                    ? `${nameOf(status.room, status.removedBy)} removed ${widgetName} from ${roomName}.`
                    : `${widgetName} is no longer in ${roomName}.`;
                if (canRecreateWidget(client, status.room, entry)) {
                    action = (
                        <AccessibleButton kind="primary" onClick={onAddBack} disabled={busy}>
                            Add it back
                        </AccessibleButton>
                    );
                }
            }
            break;
        case "upgraded":
            title = "This room was upgraded";
            text = `${roomName} moved to a new room, and its widgets don't move with it.`;
            action = (
                <AccessibleButton kind="primary" onClick={() => viewRoom(status.newRoomId)}>
                    Go to the new room
                </AccessibleButton>
            );
            break;
        case "left":
            title = "You're not in this room";
            text = `${widgetName} is in ${roomName}, and you're no longer a member there.`;
            break;
    }

    return (
        <div className="haven_WidgetAppView_unavailable">
            <h2>{title}</h2>
            <p>{text}</p>
            <div className="haven_WidgetAppView_unavailableButtons">
                {action}
                <AccessibleButton kind={action ? "secondary" : "primary"} onClick={onRemove} disabled={busy}>
                    Remove from Apps
                </AccessibleButton>
            </div>
        </div>
    );
}

/**
 * Pops the widget out into its own window, as the pop-out button on a room's widget does
 * (WidgetPopoutStore.ts). The tile runs it, so the window stays connected to the client while the
 * user goes to other apps and rooms, and the tile shows where the widget went meanwhile. The
 * widget loads again in the new window: a browser can't move a running frame into another window.
 */
function PopOutButton({ uid, tile }: { uid: string; tile: React.RefObject<AppTile | null> }): JSX.Element {
    const store = WidgetPopoutStore.instance;
    const poppedOut = useSyncExternalStore(
        (onChange) => store.subscribe(onChange),
        () => store.isPoppedOut(uid),
    );
    const label = poppedOut ? "Show window" : "Pop out";
    return (
        <AccessibleButton
            className="haven_WidgetAppView_headerButton"
            title={label}
            aria-label={label}
            onClick={() => (poppedOut ? store.focus(uid) : tile.current?.havenPopOutClick())}
        >
            <PopOutIcon width="20px" height="20px" />
        </AccessibleButton>
    );
}

interface Props {
    roomId: string;
    widgetId: string;
}

export function WidgetAppView({ roomId, widgetId }: Props): JSX.Element | null {
    const client = useMatrixClientContext();
    const entry = useWidgetAppEntries(client).find((e) => e.room_id === roomId && e.widget_id === widgetId);
    const status = useWidgetAppStatus(client, roomId, widgetId);
    const tile = useRef<AppTile>(null);
    useRefreshEntry(client, status, entry);

    useEffect(() => {
        const id = widgetAppId(roomId, widgetId);
        noteWidgetAppOpen(id);
        return () => noteWidgetAppOpen(null);
    }, [roomId, widgetId]);

    // Removed from Apps on another device: nothing left to show. (Removing it on this one leaves
    // the page before the list changes; see removeWidgetApps.)
    useEffect(() => {
        if (!entry) defaultDispatcher.dispatch({ action: Action.ViewHomePage });
    }, [entry]);

    const onRemove = useCallback(() => {
        removeWidgetApp(client, roomId, widgetId).catch((e) => {
            logger.error("Couldn't remove a widget app", e);
            Modal.createDialog(ErrorDialog, {
                title: "Couldn't remove the widget from Apps",
                description: "Check your connection and try again.",
            });
        });
    }, [client, roomId, widgetId]);

    if (!entry) return null;

    const widgetName = status.kind === "available" ? WidgetUtils.getWidgetName(status.app) : widgetAppName(entry);
    const roomName = status.room?.name ?? entry.room_name ?? "its room";

    return (
        <div className="haven_WidgetAppView">
            <div className="haven_WidgetAppView_header">
                {status.kind === "available" && <WidgetAvatar app={status.app} size="24px" />}
                <h1 className="haven_WidgetAppView_title">{widgetName}</h1>
                <div className="haven_WidgetAppView_headerButtons">
                    {status.kind === "available" && (
                        <PopOutButton uid={WidgetUtils.getWidgetUid(status.app)} tile={tile} />
                    )}
                    <AppPageOptionsMenu
                        roomId={roomId}
                        roomName={status.room?.getMyMembership() === KnownMembership.Join ? roomName : null}
                        onRemove={onRemove}
                    />
                </div>
            </div>
            <div className="haven_WidgetAppView_body">
                {status.kind === "available" ? (
                    <AppTile
                        ref={tile}
                        app={status.app}
                        fullWidth
                        showMenubar={false}
                        room={status.room}
                        userId={client.getSafeUserId()}
                        creatorUserId={status.app.creatorUserId}
                        widgetPageTitle={WidgetUtils.getWidgetDataTitle(status.app)}
                        waitForIframeLoad={status.app.waitForIframeLoad}
                        havenOnPopoutRefused={showPopoutRefusedDialog}
                    />
                ) : (
                    <Unavailable
                        client={client}
                        status={status}
                        entry={entry}
                        widgetName={widgetName}
                        roomName={roomName}
                        onRemove={onRemove}
                    />
                )}
            </div>
        </div>
    );
}

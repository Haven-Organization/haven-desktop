/*
 * Haven apps framework — AppContextMenu
 *
 * Right-click menu for an app's button in the space bar (see SpacePanelAppButtons). Mirrors the
 * styling of SpaceContextMenu / HomeButtonContextMenu (same IconizedContextMenu building blocks)
 * so pinning an app looks and behaves like right-clicking a space.
 */

import React, { type JSX } from "react";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { type IProps as IContextMenuProps } from "../../../../element-web/apps/web/src/components/structures/ContextMenu";
import IconizedContextMenu, {
    IconizedContextMenuCheckbox,
    IconizedContextMenuOption,
    IconizedContextMenuOptionList,
} from "../../../../element-web/apps/web/src/components/views/context_menus/IconizedContextMenu";
import defaultDispatcher from "../../../../element-web/apps/web/src/dispatcher/dispatcher";
import { Action } from "../../../../element-web/apps/web/src/dispatcher/actions";
import { type ViewRoomPayload } from "../../../../element-web/apps/web/src/dispatcher/payloads/ViewRoomPayload";
import { setAppPinned } from "../pinnedApps";
import { findWidgetAppEntryByAppId, goToRoomLabel } from "../widgetApps/widgetApps";
import { type HavenApp } from "../types";
import { canPopOutApp, popOutApp } from "../appPopout/popOutApp";
import { findGameAppEntryByAppId } from "../gameApps/gameApps";
import { confirmRemoveFromApps } from "../removeFromApps";
import { isInRoom } from "../gameApps/gameEvent";

interface Props extends IContextMenuProps {
    app: HavenApp;
    client: MatrixClient;
    pinned: boolean;
    hideHeader?: boolean;
}

export function AppContextMenu({ app, client, pinned, hideHeader, onFinished, ...props }: Props): JSX.Element {
    const Icon = app.Icon;
    // A room widget the user added to their apps (widgetApps.ts), rather than a built-in app.
    const widgetEntry = findWidgetAppEntryByAppId(client, app.id);
    const widgetRoom = widgetEntry ? client.getRoom(widgetEntry.room_id) : null;
    // A game shared in a room that the user added to their apps (gameApps.ts).
    const gameEntry = findGameAppEntryByAppId(client, app.id);
    const gameRoom = gameEntry && isInRoom(client, gameEntry.room_id) ? client.getRoom(gameEntry.room_id) : null;
    return (
        <IconizedContextMenu {...props} onFinished={onFinished} className="mx_SpacePanel_contextMenu" compact>
            {!hideHeader && (
                <div className="mx_SpacePanel_contextMenu_header haven_AppContextMenu_header">
                    {app.image ? (
                        <img className="haven_AppContextMenu_headerIcon" src={app.image} alt="" />
                    ) : (
                        <Icon className="haven_AppContextMenu_headerIcon" />
                    )}
                    <span>{app.name}</span>
                </div>
            )}
            <IconizedContextMenuOptionList first>
                <IconizedContextMenuCheckbox
                    label="Pin to sidebar"
                    active={pinned}
                    onClick={() => {
                        onFinished();
                        void setAppPinned(client, app.id, !pinned);
                    }}
                />
                {canPopOutApp(client, app) && (
                    <IconizedContextMenuOption
                        label="Pop out"
                        onClick={() => {
                            onFinished();
                            // Straight from the click, so popup blockers allow the window.
                            popOutApp(client, app);
                        }}
                    />
                )}
            </IconizedContextMenuOptionList>
            {widgetEntry && (
                <IconizedContextMenuOptionList>
                    {widgetRoom && (
                        <IconizedContextMenuOption
                            label={goToRoomLabel(widgetRoom.name)}
                            onClick={() => {
                                onFinished();
                                defaultDispatcher.dispatch<ViewRoomPayload>({
                                    action: Action.ViewRoom,
                                    room_id: widgetEntry.room_id,
                                    metricsTrigger: undefined,
                                });
                            }}
                        />
                    )}
                    <IconizedContextMenuOption
                        label="Remove from Apps"
                        isDestructive
                        onClick={() => {
                            onFinished();
                            void confirmRemoveFromApps(client, app.id, app.name);
                        }}
                    />
                </IconizedContextMenuOptionList>
            )}
            {gameEntry && (
                <IconizedContextMenuOptionList>
                    {gameRoom && (
                        <IconizedContextMenuOption
                            label={goToRoomLabel(gameRoom.name)}
                            onClick={() => {
                                onFinished();
                                // To the message the game was shared in.
                                defaultDispatcher.dispatch<ViewRoomPayload>({
                                    action: Action.ViewRoom,
                                    room_id: gameEntry.room_id,
                                    event_id: gameEntry.event_id,
                                    highlighted: true,
                                    metricsTrigger: undefined,
                                });
                            }}
                        />
                    )}
                    <IconizedContextMenuOption
                        label="Remove from Apps"
                        isDestructive
                        onClick={() => {
                            onFinished();
                            void confirmRemoveFromApps(client, app.id, app.name);
                        }}
                    />
                </IconizedContextMenuOptionList>
            )}
        </IconizedContextMenu>
    );
}

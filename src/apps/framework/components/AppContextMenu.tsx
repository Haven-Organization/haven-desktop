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
    IconizedContextMenuOptionList,
} from "../../../../element-web/apps/web/src/components/views/context_menus/IconizedContextMenu";
import { setAppPinned } from "../pinnedApps";
import { type HavenApp } from "../types";

interface Props extends IContextMenuProps {
    app: HavenApp;
    client: MatrixClient;
    pinned: boolean;
    hideHeader?: boolean;
}

export function AppContextMenu({ app, client, pinned, hideHeader, onFinished, ...props }: Props): JSX.Element {
    const Icon = app.Icon;
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
            </IconizedContextMenuOptionList>
        </IconizedContextMenu>
    );
}

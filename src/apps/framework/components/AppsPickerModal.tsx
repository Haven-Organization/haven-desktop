/*
 * Haven apps framework — AppsPickerModal
 *
 * The popup opened by clicking the Apps button (see AppsButton). Shows every registered app in a
 * 3x3 grid, anchored near the triggering button — same ContextMenu/toRightOf mechanism already
 * used for AppContextMenu, rather than a centered BaseDialog, since this is meant to feel like
 * opening a menu next to the button, not a full modal dialog.
 */

import React, { type JSX, useCallback } from "react";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import { Tooltip } from "@vector-im/compound-web";

import defaultDispatcher from "../../../../element-web/apps/web/src/dispatcher/dispatcher";
import ContextMenu, {
    type IProps as IContextMenuProps,
    ChevronFace,
    useContextMenu,
    toRightOf,
} from "../../../../element-web/apps/web/src/components/structures/ContextMenu";
import { getLaunchableApps } from "../registry";
import { usePinnedAppIds } from "../pinnedApps";
import { useWidgetAppEntries } from "../widgetApps/widgetApps";
import { useGameAppEntries } from "../gameApps/gameApps";
import { AppContextMenu } from "./AppContextMenu";
import { type HavenApp } from "../types";

interface TileProps {
    app: HavenApp;
    client: MatrixClient;
    pinned: boolean;
    onLaunched: () => void;
}

function AppTile({ app, client, pinned, onLaunched }: TileProps): JSX.Element {
    const Icon = app.Icon;
    const [menuDisplayed, handle, openMenu, closeMenu] = useContextMenu<HTMLButtonElement>();

    const handleClick = useCallback(() => {
        defaultDispatcher.dispatch({ action: app.homeAction }, true);
        onLaunched();
    }, [app, onLaunched]);

    return (
        <div className="haven_AppsPickerModal_tileWrapper">
            {/* The full name: under the icon, a long one is cut short. */}
            <Tooltip label={app.name} placement="bottom">
                <button
                    ref={handle}
                    className="haven_AppsPickerModal_tile"
                    onClick={handleClick}
                    onContextMenu={openMenu}
                    aria-label={app.name}
                >
                    <div className="haven_AppsPickerModal_tileIcon" aria-hidden="true">
                        {app.image ? <img src={app.image} alt="" /> : <Icon />}
                    </div>
                    <span className="haven_AppsPickerModal_tileLabel">{app.name}</span>
                </button>
            </Tooltip>
            {menuDisplayed && handle.current && (
                <AppContextMenu
                    {...toRightOf(handle.current.getBoundingClientRect())}
                    app={app}
                    client={client}
                    pinned={pinned}
                    onFinished={closeMenu}
                />
            )}
        </div>
    );
}

interface Props extends IContextMenuProps {
    client: MatrixClient;
}

export function AppsPickerModal({ client, onFinished, ...props }: Props): JSX.Element {
    const pinnedIds = usePinnedAppIds(client);
    useWidgetAppEntries(client); // re-render when the user's widget apps change
    useGameAppEntries(client); // and their game apps

    return (
        <ContextMenu
            {...props}
            onFinished={onFinished}
            menuClassName="haven_AppsPickerModal"
            chevronFace={ChevronFace.None}
        >
            <div className="haven_AppsPickerModal_grid">
                {getLaunchableApps().map((app) => (
                    <AppTile
                        key={app.id}
                        app={app}
                        client={client}
                        pinned={pinnedIds.includes(app.id)}
                        onLaunched={onFinished}
                    />
                ))}
            </div>
        </ContextMenu>
    );
}

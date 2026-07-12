/*
 * Haven apps framework — SpacePanelAppButtons
 *
 * Injected into InnerSpacePanel above the Home button, replacing the old
 * social-only SpacePanelSocialButton. Shows every pinned app's button (always
 * present, persisted via account data) plus the currently-open app's button if
 * it isn't pinned (ephemeral — only shown while that app is open).
 *
 * Uses fully custom CSS classes (no mx_ classes) to avoid inheriting
 * element-web's "always selected" avatar-placeholder styling.
 */

import React, { type JSX, useCallback } from "react";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import defaultDispatcher from "../../../../element-web/apps/web/src/dispatcher/dispatcher";
import { useContextMenu, toRightOf } from "../../../../element-web/apps/web/src/components/structures/ContextMenu";
import { getEnabledApps } from "../registry";
import { usePinnedAppIds } from "../pinnedApps";
import { useActiveAppId } from "../hooks/useActiveAppId";
import { AppContextMenu } from "./AppContextMenu";
import { type HavenApp } from "../types";

interface AppButtonProps {
    app: HavenApp;
    client: MatrixClient;
    pinned: boolean;
    isPanelCollapsed: boolean;
    isActive: boolean;
}

function AppButton({ app, client, pinned, isPanelCollapsed, isActive }: AppButtonProps): JSX.Element {
    const Icon = app.Icon;
    const [menuDisplayed, handle, openMenu, closeMenu] = useContextMenu<HTMLButtonElement>();

    const handleClick = useCallback(() => {
        // sync: see the comment on handleMetaSpaceClickCapture in SpacePanel.tsx — avoids a race
        // against a currently-active space's own (also-deferred) navigation dispatch.
        defaultDispatcher.dispatch({ action: app.homeAction }, true);
    }, [app]);

    return (
        <li
            className={`haven_SpaceAppItem${isPanelCollapsed ? " haven_SpaceAppItem--collapsed" : ""}`}
            role="treeitem"
            aria-selected={isActive}
            title={isPanelCollapsed ? app.name : undefined}
            data-app-id={app.id}
        >
            <button
                ref={handle}
                className={`haven_SpaceAppButton${isActive ? " haven_SpaceAppButton--active" : ""}`}
                onClick={handleClick}
                onContextMenu={openMenu}
                aria-label={app.name}
                aria-current={isActive ? "page" : undefined}
            >
                <div className="haven_SpaceAppButton_icon" aria-hidden="true">
                    {app.image ? <img src={app.image} alt="" /> : <Icon />}
                </div>
                {!isPanelCollapsed && <span className="haven_SpaceAppButton_label">{app.name}</span>}
            </button>
            {menuDisplayed && handle.current && (
                <AppContextMenu
                    {...toRightOf(handle.current.getBoundingClientRect())}
                    app={app}
                    client={client}
                    pinned={pinned}
                    onFinished={closeMenu}
                />
            )}
        </li>
    );
}

interface Props {
    client: MatrixClient;
    isPanelCollapsed: boolean;
}

export function SpacePanelAppButtons({ client, isPanelCollapsed }: Props): JSX.Element {
    const pinnedIds = usePinnedAppIds(client);
    const activeAppId = useActiveAppId();

    const enabledApps = getEnabledApps();
    const pinnedApps = enabledApps.filter((app) => pinnedIds.includes(app.id));
    const activeUnpinnedApp =
        activeAppId && !pinnedIds.includes(activeAppId)
            ? enabledApps.find((app) => app.id === activeAppId)
            : undefined;

    // Open (unpinned) app first, then pinned apps — the Apps button above always shows regardless,
    // so this list itself may legitimately be empty.
    const appsToShow = activeUnpinnedApp ? [activeUnpinnedApp, ...pinnedApps] : pinnedApps;

    return (
        <>
            {appsToShow.map((app) => (
                <AppButton
                    key={app.id}
                    app={app}
                    client={client}
                    pinned={pinnedIds.includes(app.id)}
                    isPanelCollapsed={isPanelCollapsed}
                    isActive={app.id === activeAppId}
                />
            ))}
        </>
    );
}

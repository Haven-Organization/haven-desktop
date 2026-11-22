/*
 * Haven apps framework - the "..." menu in the header of a widget app's or game app's page: the
 * way to its room, and "Remove from Apps".
 */

import React, { type JSX } from "react";
import { OverflowHorizontalIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import {
    aboveLeftOf,
    ContextMenuTooltipButton,
    useContextMenu,
} from "../../../../element-web/apps/web/src/components/structures/ContextMenu";
import IconizedContextMenu, {
    IconizedContextMenuOption,
    IconizedContextMenuOptionList,
} from "../../../../element-web/apps/web/src/components/views/context_menus/IconizedContextMenu";
import defaultDispatcher from "../../../../element-web/apps/web/src/dispatcher/dispatcher";
import { Action } from "../../../../element-web/apps/web/src/dispatcher/actions";
import { type ViewRoomPayload } from "../../../../element-web/apps/web/src/dispatcher/payloads/ViewRoomPayload";
import { goToRoomLabel } from "../widgetApps/widgetApps";

interface Props {
    roomId: string;
    /** The room's name, when the user is in it and can go there. */
    roomName: string | null;
    /** A message to show in the room, such as the one a game was shared in. */
    eventId?: string;
    onRemove: () => void;
}

export function AppPageOptionsMenu({ roomId, roomName, eventId, onRemove }: Props): JSX.Element {
    const [menuDisplayed, handle, openMenu, closeMenu] = useContextMenu<HTMLElement>();
    return (
        <>
            <ContextMenuTooltipButton
                ref={handle}
                className="haven_WidgetAppView_headerButton"
                title="Options"
                isExpanded={menuDisplayed}
                onClick={openMenu}
            >
                <OverflowHorizontalIcon width="20px" height="20px" />
            </ContextMenuTooltipButton>
            {menuDisplayed && handle.current && (
                <IconizedContextMenu
                    {...aboveLeftOf(handle.current.getBoundingClientRect())}
                    onFinished={closeMenu}
                    compact
                >
                    <IconizedContextMenuOptionList first>
                        {roomName && (
                            <IconizedContextMenuOption
                                label={goToRoomLabel(roomName)}
                                onClick={() => {
                                    closeMenu();
                                    defaultDispatcher.dispatch<ViewRoomPayload>({
                                        action: Action.ViewRoom,
                                        room_id: roomId,
                                        event_id: eventId,
                                        highlighted: !!eventId,
                                        metricsTrigger: undefined,
                                    });
                                }}
                            />
                        )}
                        <IconizedContextMenuOption
                            label="Remove from Apps"
                            isDestructive
                            onClick={() => {
                                closeMenu();
                                onRemove();
                            }}
                        />
                    </IconizedContextMenuOptionList>
                </IconizedContextMenu>
            )}
        </>
    );
}

/*
 * Social Overlay — RoomPickerModal
 *
 * A fork of Element's own ForwardDialog room list (element-web/apps/web/src/components/views/
 * dialogs/ForwardDialog.tsx): same list chrome (DecoratedRoomAvatar + name + RoomContextDetails,
 * TruncatedList, RovingTabIndex keyboard nav, AutoHideScrollbar), but repurposed as a plain room
 * *picker* rather than a "forward this message to N rooms" tool:
 *  - No message preview (there's no already-sent event here, just a destination to pick).
 *  - No per-row Send button/state machine — clicking the row itself selects the room and closes.
 *  - The search box carries a removable "Social Rooms" pill (styled like SpotlightDialog's own
 *    "Public rooms" filter chip) that scopes the list to isSocialRoom() rooms by default; removing
 *    it broadens the search to every joined, non-space room, same room source as ForwardDialog.
 */

import React, { type JSX, useCallback, useMemo, useState } from "react";
import classnames from "classnames";
import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";
import { CloseIcon } from "@vector-im/compound-design-tokens/assets/web/icons";
import { AutoHideScrollbar } from "@element-hq/web-shared-components";

import BaseDialog from "../../../../element-web/apps/web/src/components/views/dialogs/BaseDialog";
import MatrixClientContext from "../../../../element-web/apps/web/src/contexts/MatrixClientContext";
import AccessibleButton from "../../../../element-web/apps/web/src/components/views/elements/AccessibleButton";
import DecoratedRoomAvatar from "../../../../element-web/apps/web/src/components/views/avatars/DecoratedRoomAvatar";
import { RoomContextDetails } from "../../../../element-web/apps/web/src/components/views/rooms/RoomContextDetails";
import { OverflowTileView } from "../../../../element-web/apps/web/src/components/views/rooms/OverflowTileView";
import TruncatedList from "../../../../element-web/apps/web/src/components/views/elements/TruncatedList";
import { sortRoomsByRecency } from "../../../../element-web/apps/web/src/utils/room/sortRoomsByRecency";
import QueryMatcher from "../../../../element-web/apps/web/src/autocomplete/QueryMatcher";
import { filterBoolean } from "../../../../element-web/apps/web/src/utils/arrays";
import { useSettingValue } from "../../../../element-web/apps/web/src/hooks/useSettings";
import { getKeyBindingsManager } from "../../../../element-web/apps/web/src/KeyBindingsManager";
import { KeyBindingAction } from "../../../../element-web/apps/web/src/accessibility/KeyboardShortcuts";
import {
    type IState,
    RovingTabIndexContext,
    RovingTabIndexProvider,
    useRovingTabIndex,
} from "../../../../element-web/apps/web/src/accessibility/RovingTabIndex";
import { isSocialRoom } from "../utils/room-classifier";
import { setPendingRoomPick } from "../utils/pendingRoomPick";
import socialIcon from "../assets/social-icon.png";

interface Props {
    client: MatrixClient;
    onFinished: (roomId?: string) => void;
}

const Entry: React.FC<{ room: Room; onSelect: (room: Room) => void }> = ({ room, onSelect }) => {
    const [onFocus, isActive, ref] = useRovingTabIndex<HTMLDivElement>();
    const id = `social_RoomPickerModal_entry_${room.roomId}`;

    return (
        <div
            className={classnames("social_RoomPickerModal_entry", {
                social_RoomPickerModal_entry_active: isActive,
            })}
            role="listitem"
            ref={ref}
            onFocus={onFocus}
            id={id}
        >
            <AccessibleButton
                className="social_RoomPickerModal_entry_roomButton"
                onClick={() => onSelect(room)}
                tabIndex={isActive ? 0 : -1}
            >
                <DecoratedRoomAvatar room={room} size="32px" tooltipProps={{ tabIndex: isActive ? 0 : -1 }} />
                <span className="social_RoomPickerModal_entry_name">{room.name}</span>
                <RoomContextDetails component="span" className="social_RoomPickerModal_entry_detail" room={room} />
            </AccessibleButton>
        </div>
    );
};

export function RoomPickerModal({ client: cli, onFinished }: Props): JSX.Element {
    const [query, setQuery] = useState("");
    const lcQuery = query.toLowerCase();
    const [scopedToSocial, setScopedToSocial] = useState(true);
    const msc3946DynamicRoomPredecessors = useSettingValue("feature_dynamic_room_predecessors");

    let rooms = useMemo(
        () =>
            sortRoomsByRecency(
                cli
                    .getVisibleRooms(msc3946DynamicRoomPredecessors)
                    .filter((room) => room.getMyMembership() === KnownMembership.Join && !room.isSpaceRoom()),
                cli.getSafeUserId(),
            ),
        [cli, msc3946DynamicRoomPredecessors],
    );

    if (scopedToSocial) {
        rooms = rooms.filter((room) => isSocialRoom(room));
    }

    if (lcQuery) {
        rooms = new QueryMatcher<Room>(rooms, {
            keys: ["name"],
            funcs: [(r) => filterBoolean([r.getCanonicalAlias(), ...r.getAltAliases()])],
            shouldMatchWordsOnly: false,
        }).match(lcQuery);
    }

    const [truncateAt, setTruncateAt] = useState(20);
    function overflowTile(overflowCount: number, totalCount: number): JSX.Element {
        return <OverflowTileView remaining={overflowCount} onClick={() => setTruncateAt(totalCount)} />;
    }

    const handleSelect = useCallback(
        (room: Room) => {
            // Written synchronously, before onFinished triggers Modal's own remount of whatever
            // dialog this picker was opened on top of - see pendingRoomPick.ts for why a plain
            // onChange callback alone isn't enough when the caller is itself a Modal.createDialog
            // (e.g. PostComposerDialog), not a plain page component (e.g. FeedPane).
            setPendingRoomPick(room.roomId);
            onFinished(room.roomId);
        },
        [onFinished],
    );

    const onKeyDown = (ev: React.KeyboardEvent, state: IState): void => {
        let handled = true;
        const action = getKeyBindingsManager().getAccessibilityAction(ev);
        switch (action) {
            case KeyBindingAction.Enter:
                state.activeNode?.querySelector<HTMLButtonElement>(".social_RoomPickerModal_entry_roomButton")?.click();
                break;
            default:
                handled = false;
        }
        if (handled) {
            ev.preventDefault();
            ev.stopPropagation();
        }
    };

    return (
        <MatrixClientContext.Provider value={cli}>
            <BaseDialog
                title="Post to"
                className="social_RoomPickerModal"
                contentId="social_RoomPickerModal_list"
                onFinished={() => onFinished(undefined)}
                fixedWidth={false}
            >
                <RovingTabIndexProvider
                    handleUpDown
                    handleInputFields
                    onKeyDown={onKeyDown}
                    scrollIntoView={{ block: "center" }}
                >
                    {({ onKeyDownHandler }: { onKeyDownHandler(ev: React.KeyboardEvent): void }) => (
                        <div className="social_RoomPickerModal_list" id="social_RoomPickerModal_list">
                            <RovingTabIndexContext.Consumer>
                                {(context: { state: IState }) => (
                                    <div className="social_RoomPickerModal_searchBox">
                                        {scopedToSocial && (
                                            <span className="social_RoomPickerModal_searchPill">
                                                <img
                                                    src={socialIcon}
                                                    alt=""
                                                    className="social_RoomPickerModal_searchPill_icon"
                                                />
                                                <span>Social Rooms</span>
                                                <AccessibleButton
                                                    className="social_RoomPickerModal_searchPill_remove"
                                                    onClick={() => setScopedToSocial(false)}
                                                    aria-label="Remove Social Rooms filter"
                                                >
                                                    <CloseIcon width="14px" height="14px" />
                                                </AccessibleButton>
                                            </span>
                                        )}
                                        <input
                                            type="text"
                                            className="social_RoomPickerModal_searchInput"
                                            placeholder="Search rooms…"
                                            value={query}
                                            onChange={(e) => setQuery(e.target.value)}
                                            onKeyDown={onKeyDownHandler}
                                            autoFocus
                                            autoComplete="off"
                                            aria-activedescendant={context.state.activeNode?.id}
                                            aria-owns="social_RoomPickerModal_resultsList"
                                        />
                                    </div>
                                )}
                            </RovingTabIndexContext.Consumer>
                            <AutoHideScrollbar className="mx_AutoHideScrollbar social_RoomPickerModal_content">
                                {rooms.length > 0 ? (
                                    <div className="social_RoomPickerModal_results">
                                        <TruncatedList
                                            id="social_RoomPickerModal_resultsList"
                                            className="social_RoomPickerModal_resultsList"
                                            truncateAt={truncateAt}
                                            createOverflowElement={overflowTile}
                                            getChildren={(start, end) =>
                                                rooms
                                                    .slice(start, end)
                                                    .map((room) => (
                                                        <Entry key={room.roomId} room={room} onSelect={handleSelect} />
                                                    ))
                                            }
                                            getChildCount={() => rooms.length}
                                        />
                                    </div>
                                ) : (
                                    <span className="social_RoomPickerModal_noResults">No results</span>
                                )}
                            </AutoHideScrollbar>
                        </div>
                    )}
                </RovingTabIndexProvider>
            </BaseDialog>
        </MatrixClientContext.Provider>
    );
}

/*
Copyright 2024,2025 New Vector Ltd.
Copyright 2021-2023 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, {
    type JSX,
    type Dispatch,
    type KeyboardEvent,
    type KeyboardEventHandler,
    type ReactElement,
    type ReactNode,
    type SetStateAction,
    useCallback,
    useContext,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
} from "react";
import { createPortal, flushSync } from "react-dom";
import {
    type Room,
    RoomEvent,
    ClientEvent,
    type MatrixClient,
    MatrixError,
    EventType,
    RoomType,
    GuestAccess,
    HistoryVisibility,
    type HierarchyRoom,
    type HierarchyRelation,
    JoinRule,
} from "matrix-js-sdk/src/matrix";
import { RoomHierarchy } from "matrix-js-sdk/src/room-hierarchy";
import classNames from "classnames";
import { sortBy, uniqBy } from "lodash";
import { logger } from "matrix-js-sdk/src/logger";
import { KnownMembership, type SpaceChildEventContent } from "matrix-js-sdk/src/types";
import { ChevronDownIcon, CheckIcon } from "@vector-im/compound-design-tokens/assets/web/icons";
import DragListIcon from "@vector-im/compound-design-tokens/assets/web/icons/drag-list";
import { LinkedText } from "@element-hq/web-shared-components";
import {
    DragDropContext,
    Draggable,
    Droppable,
    type DropResult,
    type DragStart,
    type DraggableProvidedDragHandleProps,
    type DraggableProvidedDraggableProps,
} from "react-beautiful-dnd";

import defaultDispatcher from "../../dispatcher/dispatcher";
import { _t } from "../../languageHandler";
import AccessibleButton, { type ButtonEvent } from "../views/elements/AccessibleButton";
import Spinner from "../views/elements/Spinner";
import SearchBox from "./SearchBox";
import RoomAvatar from "../views/avatars/RoomAvatar";
import StyledCheckbox from "../views/elements/StyledCheckbox";
import BaseAvatar from "../views/avatars/BaseAvatar";
import { mediaFromMxc } from "../../customisations/Media";
import InfoTooltip from "../views/elements/InfoTooltip";
import TextWithTooltip from "../views/elements/TextWithTooltip";
import { useStateToggle } from "../../hooks/useStateToggle";
import { getChildOrder } from "../../stores/spaces/SpaceStore";
import { reorderLexicographically } from "../../utils/stringOrderField";
import { topicToHtml } from "../../HtmlUtils";
import { useDispatcher } from "../../hooks/useDispatcher";
import { Action } from "../../dispatcher/actions";
import { type IState, RovingTabIndexProvider, useRovingTabIndex } from "../../accessibility/RovingTabIndex";
import MatrixClientContext from "../../contexts/MatrixClientContext";
import { useTypedEventEmitterState } from "../../hooks/useEventEmitter";
import { awaitRoomDownSync } from "../../utils/RoomUpgrade";
import { type ViewRoomPayload } from "../../dispatcher/payloads/ViewRoomPayload";
import { type JoinRoomReadyPayload } from "../../dispatcher/payloads/JoinRoomReadyPayload";
import { KeyBindingAction } from "../../accessibility/KeyboardShortcuts";
import { getKeyBindingsManager } from "../../KeyBindingsManager";
import { getTopic } from "../../hooks/room/useTopic";
import { getDisplayAliasForAliasSet } from "../../Rooms";
import SettingsStore from "../../settings/SettingsStore";
import { filterBoolean } from "../../utils/arrays.ts";
import { type RoomViewStore } from "../../stores/RoomViewStore.tsx";
import RoomContext from "../../contexts/RoomContext.ts";

interface IProps {
    space: Room;
    initialText?: string;
    additionalButtons?: ReactNode;
    showRoom(this: void, cli: MatrixClient, hierarchy: RoomHierarchy, roomId: string, roomType?: RoomType): void;
}

interface ITileProps {
    room: HierarchyRoom;
    suggested?: boolean;
    selected?: boolean;
    numChildRooms?: number;
    hasPermissions?: boolean;
    children?: ReactNode;
    onViewRoomClick(this: void): void;
    onJoinRoomClick(this: void): Promise<unknown>;
    onToggleClick?(this: void): void;
    /** Haven: drag-to-reorder (see HierarchyLevel's own canReorder/getSortedChildEntries) - both
     *  undefined when this room isn't currently draggable (only one room at this level, no
     *  permission, or a search filter is active). dragHandleProps go on a dedicated handle
     *  element, not the whole tile, so the existing click-to-view/toggle behaviour is untouched. */
    dragHandleProps?: DraggableProvidedDragHandleProps | null;
    draggableProps?: DraggableProvidedDraggableProps;
    isDragging?: boolean;
    /** Haven: true once this room has ever been dragged as part of a reorder - see SpaceHierarchy's
     *  own dragStartedSubspaceIds state for why this can't just live in this component's own
     *  local state (a dragged Tile gets portaled to <body> and back, which remounts it and would
     *  otherwise reset a purely-local "stay collapsed" flag right as the drag ends). */
    forceCollapsed?: boolean;
}

const Tile = React.forwardRef<HTMLLIElement, ITileProps>(function Tile(
    {
        room,
        suggested,
        selected,
        hasPermissions,
        onToggleClick,
        onViewRoomClick,
        onJoinRoomClick,
        numChildRooms,
        children,
        dragHandleProps,
        draggableProps,
        isDragging,
        forceCollapsed,
    },
    ref,
) {
    const cli = useContext(MatrixClientContext);
    const joinedRoom = useTypedEventEmitterState(cli, ClientEvent.Room, () => {
        const cliRoom = cli?.getRoom(room.room_id);
        return cliRoom?.getMyMembership() === KnownMembership.Join ? cliRoom : undefined;
    });
    const joinedRoomName = useTypedEventEmitterState(joinedRoom, RoomEvent.Name, (room) => room?.name);
    const name =
        joinedRoomName ||
        room.name ||
        room.canonical_alias ||
        room.aliases?.[0] ||
        (room.room_type === RoomType.Space ? _t("common|unnamed_space") : _t("common|unnamed_room"));

    const [showChildren, toggleShowChildren, setShowChildren] = useStateToggle(!forceCollapsed);
    // Haven: collapse a subspace the moment it starts being dragged, and leave it collapsed
    // after the drop - a dragged subspace's own clone showing its full expanded child list
    // makes an unwieldy, oversized drag preview, and nothing about reordering the subspace
    // itself needs its children visible either during or after the move. Covers both: the
    // `!forceCollapsed` initializer above handles a *remounted* Tile starting out collapsed
    // (portaling a Tile in and back out of <body> while dragging remounts it, which would
    // otherwise silently reset a purely-local "stay collapsed" flag right as the drag ends);
    // this effect handles collapsing an *already-mounted* Tile the moment dragging begins, or
    // if forceCollapsed itself flips true without a remount in between.
    useEffect(() => {
        if (isDragging || forceCollapsed) setShowChildren(false);
    }, [isDragging, forceCollapsed, setShowChildren]);
    // Haven: react-beautiful-dnd measures a draggable's real DOM dimensions on the first
    // mousemove that exceeds its lift threshold - not on this mousedown/touchstart itself - but
    // it has no support for that size changing again once a drag is already underway (the same
    // reason the effect above exists). Waiting for the isDragging-driven effect above is a whole
    // render too late: by the time that state change commits, RBD has already measured the
    // still-expanded box, which is exactly what threw off its cursor-offset and
    // sibling-displacement math for larger, still-expanded subspaces. Collapsing here instead,
    // synchronously via flushSync, guarantees the DOM already reflects the collapsed size well
    // before that later mousemove fires.
    const collapseBeforeLift = (): void => {
        if (room.room_type === RoomType.Space) {
            flushSync(() => setShowChildren(false));
        }
    };
    // Haven: renamed from the destructured `ref` this hook returns - the forwardRef parameter
    // above (also conventionally named `ref`) is a *different* DOM node (the outer <li>, for
    // react-beautiful-dnd's own Draggable), not this one (the inner AccessibleButton, for roving
    // tabindex focus management) - keeping both named `ref` would shadow one of them silently.
    const [onFocus, isActive, rovingRef, nodeRef] = useRovingTabIndex();
    const [busy, setBusy] = useState(false);
    const checkboxLabelId = useId();

    const onPreviewClick = (ev: ButtonEvent): void => {
        ev.preventDefault();
        ev.stopPropagation();
        onViewRoomClick();
    };
    const onJoinClick = async (ev: ButtonEvent): Promise<void> => {
        setBusy(true);
        ev.preventDefault();
        ev.stopPropagation();
        try {
            await onJoinRoomClick();
            await awaitRoomDownSync(cli, room.room_id);
        } finally {
            setBusy(false);
        }
    };

    let button: ReactElement;
    if (busy) {
        button = (
            <AccessibleButton
                disabled={true}
                onClick={onJoinClick}
                kind="primary_outline"
                onFocus={onFocus}
                tabIndex={isActive ? 0 : -1}
                title={_t("space|joining_space")}
            >
                <Spinner size={24} />
            </AccessibleButton>
        );
    } else if (joinedRoom || room.join_rule === JoinRule.Knock) {
        // If the room is knockable, show the "View" button even if we are not a member; that
        // allows us to reuse the "request to join" UX in RoomView.
        button = (
            <AccessibleButton
                onClick={onPreviewClick}
                kind="primary_outline"
                onFocus={onFocus}
                tabIndex={isActive ? 0 : -1}
            >
                {_t("action|view")}
            </AccessibleButton>
        );
    } else {
        button = (
            <AccessibleButton onClick={onJoinClick} kind="primary" onFocus={onFocus} tabIndex={isActive ? 0 : -1}>
                {_t("action|join")}
            </AccessibleButton>
        );
    }

    let checkbox: ReactElement | undefined;
    if (onToggleClick) {
        if (hasPermissions) {
            checkbox = (
                <StyledCheckbox
                    aria-labelledby={checkboxLabelId}
                    checked={!!selected}
                    tabIndex={-1}
                    // Haven: a checkbox's own native `click` (which is what actually flips it)
                    // fires and bubbles *before* its `change` event does - stopping propagation
                    // only in onChange below is too late to stop that earlier click from also
                    // reaching this whole tile's own onClick (a couple hundred lines down),
                    // which toggles selection too since this is a permitted room. Without this,
                    // clicking the checkbox toggles selection twice in a row (once via the
                    // bubbled click, once via onChange calling onToggleClick itself) and nets out
                    // to no visible change, while clicking anywhere else on the tile works fine.
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                        e.stopPropagation();
                        onToggleClick();
                    }}
                />
            );
        } else {
            checkbox = (
                <TextWithTooltip
                    tooltip={_t("space|user_lacks_permission")}
                    onClick={(ev) => {
                        ev.stopPropagation();
                    }}
                >
                    <StyledCheckbox aria-labelledby={checkboxLabelId} disabled={true} tabIndex={-1} />
                </TextWithTooltip>
            );
        }
    }

    let avatar: ReactElement;
    if (joinedRoom) {
        avatar = <RoomAvatar room={joinedRoom} size="20px" />;
    } else {
        avatar = (
            <BaseAvatar
                name={name}
                idName={room.room_id}
                url={room.avatar_url ? mediaFromMxc(room.avatar_url).getSquareThumbnailHttp(20) : null}
                size="20px"
            />
        );
    }

    let description = _t("common|n_members", { count: room.num_joined_members ?? 0 });
    if (numChildRooms !== undefined) {
        description += " · " + _t("common|n_rooms", { count: numChildRooms });
    }

    let topic: ReactNode | string | null;
    if (joinedRoom) {
        const topicObj = getTopic(joinedRoom);
        topic = topicToHtml(topicObj?.text, topicObj?.html);
    } else {
        topic = room.topic;
    }

    let topicSection: ReactNode | undefined;
    if (topic) {
        // prevent clicks on links from bubbling up to the room tile
        topicSection = (
            <LinkedText onLinkClick={(ev) => ev.stopPropagation()}>
                {" · "}
                {topic}
            </LinkedText>
        );
    }

    let joinedSection: ReactElement | undefined;
    if (joinedRoom) {
        joinedSection = (
            <div className="mx_SpaceHierarchy_roomTile_joined">
                <CheckIcon />
                {_t("common|joined")}
            </div>
        );
    }

    let suggestedSection: ReactElement | undefined;
    if (suggested && (!joinedRoom || hasPermissions)) {
        suggestedSection = <InfoTooltip tooltip={_t("space|suggested_tooltip")}>{_t("space|suggested")}</InfoTooltip>;
    }

    const content = (
        <React.Fragment>
            <div className="mx_SpaceHierarchy_roomTile_item">
                <div className="mx_SpaceHierarchy_roomTile_avatar">{avatar}</div>
                <div className="mx_SpaceHierarchy_roomTile_name">
                    <span id={checkboxLabelId}>{name}</span>
                    {joinedSection}
                    {suggestedSection}
                </div>
                <div className="mx_SpaceHierarchy_roomTile_info">
                    {description}
                    {topicSection}
                </div>
            </div>
            <div className="mx_SpaceHierarchy_actions">
                {button}
                {checkbox}
            </div>
        </React.Fragment>
    );

    let childToggle: JSX.Element | undefined;
    let childSection: JSX.Element | undefined;
    let onKeyDown: KeyboardEventHandler | undefined;
    if (children) {
        childToggle = (
            // the chevron is purposefully a div rather than a button as it should be ignored for a11y
            // oxlint-disable-next-line jsx-a11y/click-events-have-key-events
            <div
                className={classNames("mx_SpaceHierarchy_subspace_toggle", {
                    mx_SpaceHierarchy_subspace_toggle_shown: showChildren,
                })}
                onClick={(ev) => {
                    ev.stopPropagation();
                    toggleShowChildren();
                }}
            >
                <ChevronDownIcon />
            </div>
        );

        if (showChildren) {
            const onChildrenKeyDown = (e: React.KeyboardEvent): void => {
                const action = getKeyBindingsManager().getAccessibilityAction(e);
                switch (action) {
                    case KeyBindingAction.ArrowLeft:
                        e.preventDefault();
                        e.stopPropagation();
                        nodeRef.current?.focus();
                        break;
                }
            };

            childSection = (
                <ul className="mx_SpaceHierarchy_subspace_children" onKeyDown={onChildrenKeyDown} role="group">
                    {children}
                </ul>
            );
        }

        onKeyDown = (e) => {
            let handled = false;

            const action = getKeyBindingsManager().getAccessibilityAction(e);
            switch (action) {
                case KeyBindingAction.ArrowLeft:
                    if (showChildren) {
                        handled = true;
                        toggleShowChildren();
                    }
                    break;

                case KeyBindingAction.ArrowRight:
                    handled = true;
                    if (showChildren) {
                        const childSection = nodeRef.current?.nextElementSibling;
                        childSection?.querySelector<HTMLDivElement>(".mx_SpaceHierarchy_roomTile")?.focus();
                    } else {
                        toggleShowChildren();
                    }
                    break;
            }

            if (handled) {
                e.preventDefault();
                e.stopPropagation();
            }
        };
    }

    const shouldToggle = hasPermissions && onToggleClick;

    return (
        <li
            className={classNames("mx_SpaceHierarchy_roomTileWrapper", {
                mx_SpaceHierarchy_roomTileWrapper_reorderable: !!dragHandleProps,
                mx_SpaceHierarchy_roomTileWrapper_dragging: isDragging,
            })}
            role="treeitem"
            aria-selected={selected}
            aria-labelledby={checkboxLabelId}
            aria-expanded={children ? showChildren : undefined}
            ref={ref}
            {...draggableProps}
        >
            {dragHandleProps && (
                <div
                    className="mx_SpaceHierarchy_dragHandle"
                    {...dragHandleProps}
                    onMouseDown={collapseBeforeLift}
                    onTouchStart={collapseBeforeLift}
                    onClick={(e) => e.stopPropagation()}
                >
                    <DragListIcon width="16px" height="16px" />
                </div>
            )}
            <AccessibleButton
                className={classNames("mx_SpaceHierarchy_roomTile", {
                    mx_SpaceHierarchy_subspace: room.room_type === RoomType.Space,
                    mx_SpaceHierarchy_joining: busy,
                })}
                onClick={shouldToggle ? onToggleClick : onPreviewClick}
                onKeyDown={onKeyDown}
                ref={rovingRef}
                onFocus={onFocus}
                tabIndex={isActive ? 0 : -1}
            >
                {content}
                {childToggle}
            </AccessibleButton>
            {childSection}
        </li>
    );
});
Tile.displayName = "Tile";

export const showRoom = (cli: MatrixClient, hierarchy: RoomHierarchy, roomId: string, roomType?: RoomType): void => {
    const room = hierarchy.roomMap.get(roomId);

    // Don't let the user view a room they won't be able to either peek or join:
    // fail earlier so they don't have to click back to the directory.
    if (cli.isGuest()) {
        if (!room?.world_readable && !room?.guest_can_join) {
            defaultDispatcher.dispatch({ action: "require_registration" });
            return;
        }
    }

    const roomAlias = getDisplayAliasForAliasSet(room?.canonical_alias ?? "", room?.aliases ?? []) || undefined;

    defaultDispatcher.dispatch<ViewRoomPayload>({
        action: Action.ViewRoom,
        should_peek: true,
        room_alias: roomAlias,
        room_id: roomId,
        via_servers: Array.from(hierarchy.viaMap.get(roomId) || []),
        oob_data: {
            avatarUrl: room?.avatar_url,
            // XXX: This logic is duplicated from the JS SDK which would normally decide what the name is.
            name: room?.name || roomAlias || _t("common|unnamed_room"),
            roomType,
        },
        metricsTrigger: "RoomDirectory",
    });
};

/**
 * Join a room.
 * @param cli The Matrix client
 * @param roomViewStore The RoomViewStore instance
 * @param hierarchy The RoomHierarchy instance
 * @param roomId The ID of the room to join
 * @returns A promise that resolves when the room has been joined
 */
export const joinRoom = async (
    cli: MatrixClient,
    roomViewStore: RoomViewStore,
    hierarchy: RoomHierarchy,
    roomId: string,
): Promise<unknown> => {
    // Don't let the user view a room they won't be able to either peek or join:
    // fail earlier so they don't have to click back to the directory.
    if (cli.isGuest()) {
        defaultDispatcher.dispatch({ action: "require_registration" });
        return;
    }

    try {
        await cli.joinRoom(roomId, {
            viaServers: Array.from(hierarchy.viaMap.get(roomId) || []),
        });
    } catch (err: unknown) {
        if (err instanceof MatrixError) {
            roomViewStore.showJoinRoomError(err, roomId);
        } else {
            logger.warn("Got a non-MatrixError while joining room", err);
            roomViewStore.showJoinRoomError(
                new MatrixError({
                    error: _t("error|unknown"),
                }),
                roomId,
            );
        }

        // rethrow error so that the caller can handle react to it too
        throw err;
    }

    defaultDispatcher.dispatch<JoinRoomReadyPayload>({
        action: Action.JoinRoomReady,
        roomId,
        metricsTrigger: "SpaceHierarchy",
    });
};

interface IHierarchyLevelProps {
    root: HierarchyRoom;
    roomSet: Set<HierarchyRoom>;
    hierarchy: RoomHierarchy;
    parents: Set<string>;
    selectedMap?: Map<string, Set<string>>;
    onViewRoomClick(this: void, roomId: string, roomType?: RoomType): void;
    onJoinRoomClick(this: void, roomId: string, parents: Set<string>): Promise<unknown>;
    onToggleClick?(this: void, parentId: string, childId: string): void;
    /** Haven: whether drag-to-reorder is available at all right now - true only while no search
     *  filter is active (a filtered list is sorted by relevance, not by the space's real order, so
     *  dragging within it wouldn't mean anything). Permission is checked separately per-level via
     *  this level's own hasPermissions, since a nested subspace needs its own check against itself. */
    canReorder?: boolean;
    /** Haven: room IDs of subspaces that have ever been dragged during this reorder session - see
     *  SpaceHierarchy's own state of the same name for why this has to be threaded down rather
     *  than living entirely inside Tile's own local state. */
    dragStartedSubspaceIds?: Set<string>;
}

export const toLocalRoom = (cli: MatrixClient, room: HierarchyRoom, hierarchy: RoomHierarchy): HierarchyRoom => {
    const history = cli.getRoomUpgradeHistory(
        room.room_id,
        true,
        SettingsStore.getValue("feature_dynamic_room_predecessors"),
    );

    // Pick latest room that is actually part of the hierarchy
    let cliRoom: Room | null = null;
    for (let idx = history.length - 1; idx >= 0; --idx) {
        if (hierarchy.roomMap.get(history[idx].roomId)) {
            cliRoom = history[idx];
            break;
        }
    }

    if (cliRoom) {
        return {
            ...room,
            room_id: cliRoom.roomId,
            room_type: cliRoom.getType(),
            name: cliRoom.name,
            topic: cliRoom.currentState.getStateEvents(EventType.RoomTopic, "")?.getContent().topic,
            avatar_url: cliRoom.getMxcAvatarUrl() ?? undefined,
            canonical_alias: cliRoom.getCanonicalAlias() ?? undefined,
            aliases: cliRoom.getAltAliases(),
            world_readable:
                cliRoom.currentState.getStateEvents(EventType.RoomHistoryVisibility, "")?.getContent()
                    .history_visibility === HistoryVisibility.WorldReadable,
            guest_can_join:
                cliRoom.currentState.getStateEvents(EventType.RoomGuestAccess, "")?.getContent().guest_access ===
                GuestAccess.CanJoin,
            num_joined_members: cliRoom.getJoinedMemberCount(),
        };
    }

    return room;
};

// Haven: shared by HierarchyLevel's own render (below) and SpaceHierarchy's onDragEnd (drag-to-
// reorder rooms on a space's homepage) so both stay in sync on ordering/dedup - the latter needs
// the raw m.space.child event (for its own content.order/state_key) alongside the HierarchyRoom
// the former renders, so a single list of {event, room} pairs serves both call sites.
export const getSortedChildEntries = (
    cli: MatrixClient,
    root: HierarchyRoom,
    hierarchy: RoomHierarchy,
    roomSet: Set<HierarchyRoom>,
): { event: HierarchyRelation; room: HierarchyRoom }[] => {
    const entries = filterBoolean(
        sortBy(root.children_state, (ev) => {
            return getChildOrder(ev.content.order, ev.origin_server_ts, ev.state_key);
        }).map((ev) => {
            const hierarchyRoom = hierarchy.roomMap.get(ev.state_key);
            if (!hierarchyRoom || !roomSet.has(hierarchyRoom)) return null;
            // Find the most up-to-date info for this room, if it has been upgraded and we know about it.
            return { event: ev, room: toLocalRoom(cli, hierarchyRoom, hierarchy) };
        }),
    );
    return uniqBy(entries, (entry) => entry.room.room_id);
};

export const HierarchyLevel: React.FC<IHierarchyLevelProps> = ({
    root,
    roomSet,
    hierarchy,
    parents,
    selectedMap,
    onViewRoomClick,
    onJoinRoomClick,
    onToggleClick,
    canReorder,
    dragStartedSubspaceIds,
}) => {
    const cli = useContext(MatrixClientContext);
    const space = cli.getRoom(root.room_id);
    const hasPermissions = space?.currentState.maySendStateEvent(EventType.SpaceChild, cli.getSafeUserId());

    const sortedEntries = getSortedChildEntries(cli, root, hierarchy, roomSet);
    // Haven: drag-to-reorder rooms on a space's homepage - only worth offering when there's more
    // than one room to reorder relative to, and only while the list reflects the space's real
    // order (a search filter re-sorts by relevance, so dragging within it wouldn't mean anything).
    const showDragHandles = canReorder && hasPermissions && sortedEntries.length > 1;

    const newParents = new Set(parents).add(root.room_id);
    const tiles = sortedEntries.map(({ room }, index) => {
        let tile: JSX.Element;
        if (room.room_type !== RoomType.Space) {
            tile = (
                <Tile
                    room={room}
                    suggested={hierarchy.isSuggested(root.room_id, room.room_id)}
                    selected={selectedMap?.get(root.room_id)?.has(room.room_id)}
                    onViewRoomClick={() => onViewRoomClick(room.room_id, room.room_type as RoomType)}
                    onJoinRoomClick={() => onJoinRoomClick(room.room_id, newParents)}
                    hasPermissions={hasPermissions}
                    onToggleClick={onToggleClick ? () => onToggleClick(root.room_id, room.room_id) : undefined}
                />
            );
        } else {
            if (newParents.has(room.room_id)) return null; // prevent cycles
            tile = (
                <Tile
                    room={room}
                    numChildRooms={
                        room.children_state.filter((ev) => {
                            const child = hierarchy.roomMap.get(ev.state_key);
                            return child && roomSet.has(child) && !child.room_type;
                        }).length
                    }
                    suggested={hierarchy.isSuggested(root.room_id, room.room_id)}
                    selected={selectedMap?.get(root.room_id)?.has(room.room_id)}
                    onViewRoomClick={() => onViewRoomClick(room.room_id, RoomType.Space)}
                    onJoinRoomClick={() => onJoinRoomClick(room.room_id, newParents)}
                    hasPermissions={hasPermissions}
                    onToggleClick={onToggleClick ? () => onToggleClick(root.room_id, room.room_id) : undefined}
                    forceCollapsed={dragStartedSubspaceIds?.has(room.room_id)}
                >
                    <HierarchyLevel
                        root={room}
                        roomSet={roomSet}
                        hierarchy={hierarchy}
                        parents={newParents}
                        selectedMap={selectedMap}
                        onViewRoomClick={onViewRoomClick}
                        onJoinRoomClick={onJoinRoomClick}
                        onToggleClick={onToggleClick}
                        // Haven: deliberately not forwarding the parent's own canReorder - rooms
                        // nested under a subspace shown inline here belong to that subspace, not
                        // to the top-level space this whole tree is rooted at. Reordering them
                        // needs to happen from that subspace's own homepage instead, so its own
                        // m.space.child order gets written to the right room, not this one's.
                    />
                </Tile>
            );
        }

        if (!showDragHandles) {
            return React.cloneElement(tile, { key: room.room_id });
        }

        return (
            <Draggable key={room.room_id} draggableId={`${root.room_id}:${room.room_id}`} index={index}>
                {(provided, snapshot) => {
                    const clone = React.cloneElement(tile, {
                        ref: provided.innerRef,
                        draggableProps: provided.draggableProps,
                        dragHandleProps: provided.dragHandleProps,
                        isDragging: snapshot.isDragging,
                    });
                    // Haven: react-beautiful-dnd positions the dragged clone with `position:
                    // fixed` relative to the viewport - but RoomView_wrapper (an ancestor here,
                    // since this renders inside a space's own room view) sets `contain: strict`
                    // for render-performance reasons, which makes it a *containing block* for
                    // fixed descendants too (the same effect a CSS transform has). Without a
                    // portal the clone renders at the right fixed offset, but relative to that
                    // ancestor's box instead of the viewport, landing far from the cursor. This is
                    // react-beautiful-dnd's own documented fix for exactly this situation - portal
                    // only while actually dragging, so the empty-slot placeholder still measures
                    // and animates correctly in its original spot.
                    // react-beautiful-dnd's own DraggableChildrenFn type predates portal support
                    // and only allows a plain ReactElement<HTMLElement> return - a portal is a
                    // valid renderable node at runtime regardless, so this cast just works around
                    // the stale type rather than reflecting an actual type mismatch.
                    return snapshot.isDragging
                        ? (createPortal(clone, document.body) as unknown as ReactElement<HTMLElement>)
                        : clone;
                }}
            </Draggable>
        );
    });

    if (!showDragHandles) {
        return <React.Fragment>{tiles}</React.Fragment>;
    }

    return (
        <Droppable droppableId={root.room_id}>
            {(provided) => (
                // Haven: this used to be `display: contents`, on the theory that a no-op wrapper
                // would be safest since the real <ul> lives in SpaceHierarchy/Tile's own
                // childSection. That backfired: `display: contents` makes an element generate no
                // box of its own, so react-beautiful-dnd's own Droppable hit-testing (used to
                // compute onDragEnd's `destination`, separate from the dragged clone's own visual
                // position) had nothing to measure - every drop looked like it landed outside the
                // Droppable, so reordering silently never took effect despite looking right
                // visually. A plain block div (react-beautiful-dnd's own SpacePanel.tsx puts its
                // Droppable ref directly on a real element for the same reason) fixes this - <li>s
                // are already block-level, so one extra block wrapper around them doesn't change
                // this list's layout at all.
                <div ref={provided.innerRef} {...provided.droppableProps}>
                    {tiles}
                    {provided.placeholder}
                </div>
            )}
        </Droppable>
    );
};

const INITIAL_PAGE_SIZE = 20;

export const useRoomHierarchy = (
    space: Room,
): {
    loading: boolean;
    rooms?: HierarchyRoom[];
    hierarchy?: RoomHierarchy;
    error?: Error;
    loadMore(this: void, pageSize?: number): Promise<void>;
} => {
    const [rooms, setRooms] = useState<HierarchyRoom[]>([]);
    const [hierarchy, setHierarchy] = useState<RoomHierarchy>();
    const [error, setError] = useState<Error | undefined>();

    const resetHierarchy = useCallback(() => {
        setError(undefined);
        const hierarchy = new RoomHierarchy(space, INITIAL_PAGE_SIZE);
        hierarchy.load().then(() => {
            if (space !== hierarchy.root) return; // discard stale results
            setRooms(hierarchy.rooms ?? []);
        }, setError);
        setHierarchy(hierarchy);
    }, [space]);
    useEffect(resetHierarchy, [resetHierarchy]);

    useDispatcher(defaultDispatcher, (payload) => {
        if (payload.action === Action.UpdateSpaceHierarchy) {
            setRooms([]); // TODO
            resetHierarchy();
        }
    });

    const loadMore = useCallback(
        async (pageSize?: number): Promise<void> => {
            if (!hierarchy || hierarchy.loading || !hierarchy.canLoadMore || hierarchy.noSupport || error) return;
            await hierarchy.load(pageSize).catch(setError);
            setRooms(hierarchy.rooms ?? []);
        },
        [error, hierarchy],
    );

    // Only return the hierarchy if it is for the space requested
    if (hierarchy?.root !== space) {
        return {
            loading: true,
            loadMore,
        };
    }

    return {
        loading: hierarchy.loading,
        rooms,
        hierarchy,
        loadMore,
        error,
    };
};

const useIntersectionObserver = (callback: () => void): ((element: HTMLDivElement) => void) => {
    const handleObserver = (entries: IntersectionObserverEntry[]): void => {
        const target = entries[0];
        if (target.isIntersecting) {
            callback();
        }
    };

    const observerRef = useRef<IntersectionObserver>(undefined);
    return (element: HTMLDivElement) => {
        if (observerRef.current) {
            observerRef.current.disconnect();
        } else if (element) {
            observerRef.current = new IntersectionObserver(handleObserver, {
                root: element.parentElement,
                rootMargin: "0px 0px 600px 0px",
            });
        }

        if (observerRef.current && element) {
            observerRef.current.observe(element);
        }
    };
};

interface IManageButtonsProps {
    hierarchy: RoomHierarchy;
    selected: Map<string, Set<string>>;
    setSelected: Dispatch<SetStateAction<Map<string, Set<string>>>>;
    setError: Dispatch<SetStateAction<string>>;
}

const ManageButtons: React.FC<IManageButtonsProps> = ({ hierarchy, selected, setSelected, setError }) => {
    const cli = useContext(MatrixClientContext);

    const [removing, setRemoving] = useState(false);
    const [saving, setSaving] = useState(false);

    const selectedRelations = Array.from(selected.keys()).flatMap((parentId) => {
        return [...selected.get(parentId)!.values()].map((childId) => [parentId, childId]);
    });

    const selectionAllSuggested = selectedRelations.every(([parentId, childId]) => {
        return hierarchy.isSuggested(parentId, childId);
    });

    const disabled = !selectedRelations.length || removing || saving;

    let buttonText = _t("common|saving");
    if (!saving) {
        buttonText = selectionAllSuggested ? _t("space|unmark_suggested") : _t("space|mark_suggested");
    }

    const title = !selectedRelations.length ? _t("space|select_room_below") : undefined;

    return (
        <>
            <AccessibleButton
                onClick={async (): Promise<void> => {
                    setRemoving(true);
                    try {
                        const userId = cli.getSafeUserId();
                        for (const [parentId, childId] of selectedRelations) {
                            await cli.sendStateEvent(parentId, EventType.SpaceChild, {}, childId);

                            // remove the child->parent relation too, if we have permission to.
                            const childRoom = cli.getRoom(childId);
                            const parentRelation = childRoom?.currentState.getStateEvents(
                                EventType.SpaceParent,
                                parentId,
                            );
                            if (
                                childRoom?.currentState.maySendStateEvent(EventType.SpaceParent, userId) &&
                                Array.isArray(parentRelation?.getContent().via)
                            ) {
                                await cli.sendStateEvent(childId, EventType.SpaceParent, {}, parentId);
                            }

                            hierarchy.removeRelation(parentId, childId);
                        }
                    } catch {
                        setError(_t("space|failed_remove_rooms"));
                    }
                    setRemoving(false);
                    setSelected(new Map());
                }}
                kind="danger_outline"
                disabled={disabled}
                aria-label={removing ? _t("redact|ongoing") : _t("action|remove")}
                title={title}
                placement="top"
            >
                {removing ? _t("redact|ongoing") : _t("action|remove")}
            </AccessibleButton>
            <AccessibleButton
                onClick={async (): Promise<void> => {
                    setSaving(true);
                    try {
                        for (const [parentId, childId] of selectedRelations) {
                            const suggested = !selectionAllSuggested;
                            const existingContent = hierarchy.getRelation(parentId, childId)?.content;
                            if (!existingContent || existingContent.suggested === suggested) continue;

                            const content: SpaceChildEventContent = {
                                ...existingContent,
                                suggested: !selectionAllSuggested,
                            };

                            await cli.sendStateEvent(parentId, EventType.SpaceChild, content, childId);

                            // mutate the local state to save us having to refetch the world
                            existingContent.suggested = content.suggested;
                        }
                    } catch {
                        setError("Failed to update some suggestions. Try again later");
                    }
                    setSaving(false);
                    setSelected(new Map());
                }}
                kind="primary_outline"
                disabled={disabled}
                aria-label={buttonText}
                title={title}
                placement="top"
            >
                {buttonText}
            </AccessibleButton>
        </>
    );
};

const SpaceHierarchy: React.FC<IProps> = ({ space, initialText = "", showRoom, additionalButtons }) => {
    const cli = useContext(MatrixClientContext);
    const roomContext = useContext(RoomContext);
    const [query, setQuery] = useState(initialText);

    const [selected, setSelected] = useState(new Map<string, Set<string>>()); // Map<parentId, Set<childId>>
    // Haven: onDragEnd mutates m.space.child events' own .content in place as a local echo (mirrors
    // ManageButtons' own pattern below) rather than copying hierarchy's whole room tree, so this
    // tick's only job is forcing a re-render to pick that mutation up - its value is never read.
    const [, setReorderTick] = useState(0);
    // Haven: room IDs of subspaces that have ever been dragged, kept here (not inside Tile's own
    // local state) because a dragged Tile gets portaled to <body> and back while dragging - see
    // SpaceHierarchy.tsx's own Draggable render prop comment - which remounts it and would wipe a
    // purely-local "stay collapsed" flag right as the drag ends. This lives in a stable ancestor
    // that never itself gets portaled, so it survives that remount and keeps a subspace collapsed
    // both during and permanently after its own drag.
    const [dragStartedSubspaceIds, setDragStartedSubspaceIds] = useState<Set<string>>(new Set());

    const { loading, rooms, hierarchy, loadMore, error: hierarchyError } = useRoomHierarchy(space);

    const filteredRoomSet = useMemo<Set<HierarchyRoom>>(() => {
        if (!rooms?.length || !hierarchy) return new Set();
        const lcQuery = query.toLowerCase().trim();
        if (!lcQuery) return new Set(rooms);

        const directMatches = rooms.filter((r) => {
            return r.name?.toLowerCase().includes(lcQuery) || r.topic?.toLowerCase().includes(lcQuery);
        });

        // Walk back up the tree to find all parents of the direct matches to show their place in the hierarchy
        const visited = new Set<string>();
        const queue = directMatches.map((r) => r.room_id);
        while (queue.length) {
            const roomId = queue.pop()!;
            visited.add(roomId);
            hierarchy.backRefs.get(roomId)?.forEach((parentId) => {
                if (!visited.has(parentId)) {
                    queue.push(parentId);
                }
            });
        }

        return new Set(rooms.filter((r) => visited.has(r.room_id)));
    }, [rooms, hierarchy, query]);

    const [error, setError] = useState("");
    let errorText = error;
    if (!error && hierarchyError) {
        errorText = _t("space|failed_load_rooms");
    }

    const loaderRef = useIntersectionObserver(loadMore);

    if (!loading && hierarchy!.noSupport) {
        return <p>{_t("space|incompatible_server_hierarchy")}</p>;
    }

    const onKeyDown = (ev: KeyboardEvent, state: IState): void => {
        const action = getKeyBindingsManager().getAccessibilityAction(ev);
        if (action === KeyBindingAction.ArrowDown && ev.currentTarget.classList.contains("mx_SpaceHierarchy_search")) {
            state.nodes[0]?.focus();
        }
    };

    const onToggleClick = (parentId: string, childId: string): void => {
        setError("");
        if (!selected.has(parentId)) {
            setSelected(new Map(selected.set(parentId, new Set([childId]))));
            return;
        }

        const parentSet = selected.get(parentId)!;
        if (!parentSet.has(childId)) {
            setSelected(new Map(selected.set(parentId, new Set([...parentSet, childId]))));
            return;
        }

        parentSet.delete(childId);
        setSelected(new Map(selected.set(parentId, new Set(parentSet))));
    };

    // Haven: fires the moment a drag lifts off, before onDragEnd - used only to permanently mark a
    // dragged subspace as collapsed (see the Tile-level comment on forceCollapsed/showChildren for
    // why this can't wait until onDragEnd, and why it isn't just local state on Tile itself).
    const onDragStart = (start: DragStart): void => {
        if (!hierarchy) return;
        const root = hierarchy.roomMap.get(start.source.droppableId);
        if (!root) return;
        const entries = getSortedChildEntries(cli, root, hierarchy, filteredRoomSet);
        const dragged = entries[start.source.index];
        if (dragged?.room.room_type !== RoomType.Space) return;
        setDragStartedSubspaceIds((prev) => new Set(prev).add(dragged.room.room_id));
    };

    // Haven: drag-to-reorder rooms on a space's homepage. Same-level moves only - result.destination
    // is always inside the Droppable keyed to the dragged room's own parent, so a drop into a
    // different droppableId is a no-op. Reorders write m.space.child's own real, spec-defined
    // `order` field (see stringOrderField.ts's own doc for the fractional-indexing scheme), the
    // same field the space's actual room order is read from elsewhere, so this isn't a Haven-only
    // convention - unlike the emoji/sticker pack ordering gap noted in the pack-reorder-deferred
    // memory, which has no such field to write to.
    const onDragEnd = (result: DropResult): void => {
        if (!hierarchy) return;
        if (!result.destination) return;
        if (result.destination.droppableId !== result.source.droppableId) return;
        if (result.destination.index === result.source.index) return;

        const root = hierarchy.roomMap.get(result.source.droppableId);
        if (!root) return;

        const entries = getSortedChildEntries(cli, root, hierarchy, filteredRoomSet);
        const orders = entries.map((entry) => entry.event.content.order);
        const changes = reorderLexicographically(orders, result.source.index, result.destination.index);

        changes.forEach(({ index, order }) => {
            const entry = entries[index];
            if (!entry) return;
            const content = { ...entry.event.content, order };
            entry.event.content = content; // local echo, mirrors ManageButtons' own pattern below
            cli.sendStateEvent(root.room_id, EventType.SpaceChild, content, entry.event.state_key).catch((e) => {
                logger.error("Failed to reorder room in space", e);
                setError("Failed to update some suggestions. Try again later");
            });
        });

        setReorderTick((tick) => tick + 1);
    };

    return (
        <DragDropContext onDragStart={onDragStart} onDragEnd={onDragEnd}>
            <RovingTabIndexProvider onKeyDown={onKeyDown} handleHomeEnd handleUpDown>
            {({ onKeyDownHandler }) => {
                let content: JSX.Element;
                if (!hierarchy || (loading && !rooms?.length)) {
                    content = <Spinner />;
                } else {
                    const hasPermissions =
                        space?.getMyMembership() === KnownMembership.Join &&
                        space.currentState.maySendStateEvent(EventType.SpaceChild, cli.getSafeUserId());

                    const root = hierarchy.roomMap.get(space.roomId);
                    let results: JSX.Element | undefined;
                    if (filteredRoomSet.size && root) {
                        results = (
                            <HierarchyLevel
                                root={root}
                                roomSet={filteredRoomSet}
                                hierarchy={hierarchy}
                                parents={new Set()}
                                selectedMap={selected}
                                onToggleClick={hasPermissions ? onToggleClick : undefined}
                                onViewRoomClick={(roomId, roomType) => showRoom(cli, hierarchy, roomId, roomType)}
                                onJoinRoomClick={async (roomId, parents) => {
                                    for (const parent of parents) {
                                        if (cli.getRoom(parent)?.getMyMembership() !== KnownMembership.Join) {
                                            await joinRoom(cli, roomContext.roomViewStore, hierarchy, parent);
                                        }
                                    }
                                    await joinRoom(cli, roomContext.roomViewStore, hierarchy, roomId);
                                }}
                                canReorder={!query.trim()}
                                dragStartedSubspaceIds={dragStartedSubspaceIds}
                            />
                        );
                    } else if (!hierarchy.canLoadMore) {
                        results = (
                            <div className="mx_SpaceHierarchy_noResults">
                                <h3>{_t("common|no_results_found")}</h3>
                                <div>{_t("space|no_search_result_hint")}</div>
                            </div>
                        );
                    }

                    let loader: JSX.Element | undefined;
                    if (hierarchy.canLoadMore) {
                        loader = (
                            <div ref={loaderRef}>
                                <Spinner />
                            </div>
                        );
                    }

                    content = (
                        <>
                            <div className="mx_SpaceHierarchy_listHeader">
                                <h4 className="mx_SpaceHierarchy_listHeader_header">
                                    {query.trim()
                                        ? _t("space|title_when_query_available")
                                        : _t("space|title_when_query_unavailable")}
                                </h4>
                                <div className="mx_SpaceHierarchy_listHeader_buttons">
                                    {additionalButtons}
                                    {hasPermissions && (
                                        <ManageButtons
                                            hierarchy={hierarchy}
                                            selected={selected}
                                            setSelected={setSelected}
                                            setError={setError}
                                        />
                                    )}
                                </div>
                            </div>
                            {errorText && <div className="mx_SpaceHierarchy_error">{errorText}</div>}
                            <ul
                                className="mx_SpaceHierarchy_list"
                                onKeyDown={onKeyDownHandler}
                                role="tree"
                                aria-label={_t("common|space")}
                            >
                                {results}
                            </ul>
                            {loader}
                        </>
                    );
                }

                return (
                    <>
                        <SearchBox
                            className="mx_SpaceHierarchy_search mx_textinput_icon mx_textinput_search"
                            placeholder={_t("space|search_placeholder")}
                            onSearch={setQuery}
                            autoFocus={true}
                            initialValue={initialText}
                            onKeyDown={onKeyDownHandler}
                        />

                        {content}
                    </>
                );
            }}
            </RovingTabIndexProvider>
        </DragDropContext>
    );
};

export default SpaceHierarchy;

/*
 * Haven: MSC2545 (Image Packs) — "Copy" a pack (from either the Favorite Packs list or a room's own
 * Emoji & Stickers pack list) into another room, as a brand new pack there. Deliberately modeled
 * directly on ForwardDialog.tsx - same room-search/list/roving-tabindex/per-row send-state widget,
 * same "click a room's own name to jump there and close, click its own action button to act on it
 * and stay open so several rooms can be done in one sitting" interaction - just with the message
 * preview swapped for the pack being copied, and the room list filtered down to only rooms the
 * user can actually add a pack to (see canManageImagePacks).
 */

import React, { type JSX, useMemo, useState } from "react";
import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";
import { CheckCircleIcon, CircleIcon } from "@vector-im/compound-design-tokens/assets/web/icons";
import { AutoHideScrollbar } from "@element-hq/web-shared-components";

import { _t } from "../../../languageHandler";
import dis from "../../../dispatcher/dispatcher";
import { useSettingValue } from "../../../hooks/useSettings";
import BaseDialog from "./BaseDialog";
import SearchBox from "../../structures/SearchBox";
import DecoratedRoomAvatar from "../avatars/DecoratedRoomAvatar";
import { StaticNotificationState } from "../../../stores/notifications/StaticNotificationState";
import { NotificationBadge } from "../rooms/NotificationBadge/NotificationBadge";
import { sortRoomsByRecency } from "../../../utils/room/sortRoomsByRecency";
import QueryMatcher from "../../../autocomplete/QueryMatcher";
import TruncatedList from "../elements/TruncatedList";
import { Action } from "../../../dispatcher/actions";
import { type ViewRoomPayload } from "../../../dispatcher/payloads/ViewRoomPayload";
import AccessibleButton, { type ButtonEvent } from "../elements/AccessibleButton";
import { RoomContextDetails } from "../rooms/RoomContextDetails";
import { filterBoolean } from "../../../utils/arrays";
import {
    type IState,
    RovingStateActionType,
    RovingTabIndexContext,
    RovingTabIndexProvider,
    useRovingTabIndex,
} from "../../../accessibility/RovingTabIndex";
import { getKeyBindingsManager } from "../../../KeyBindingsManager";
import { KeyBindingAction } from "../../../accessibility/KeyboardShortcuts";
import { OverflowTileView } from "../rooms/OverflowTileView";
import { PackAvatar } from "../settings/emojistickers/PackEditor";
import { type RoomImagePack, canManageImagePacks, copyImagePackToRoom, getPackAvatarMxc, packDisplayName } from "../../../utils/ImagePacks";

interface IProps {
    matrixClient: MatrixClient;
    pack: RoomImagePack;
    // Haven: closes the RoomSettingsDialog/UserSettingsDialog this was opened from, so jumping to a
    // room via the list below doesn't leave the settings dialog stacked on top of it - same
    // "closeSettingsFn" convention RoomSettingsDialog/UserSettingsDialog already use elsewhere (e.g.
    // AdvancedRoomSettingsTab's own old-room-version jump).
    closeSettingsFn?(): void;
    onFinished(this: void): void;
}

enum CopyState {
    CanCopy,
    Copying,
    Copied,
    Failed,
}

interface IEntryProps {
    room: Room;
    pack: RoomImagePack;
    matrixClient: MatrixClient;
    closeSettingsFn?(): void;
    onFinished(this: void, success: boolean): void;
}

// Haven: mirrors ForwardDialog.tsx's own Entry almost exactly - same per-row action-state UI, just
// copying the pack into `room` instead of sending an event, and with no permission branch of its
// own since the room list this is only ever given rooms already filtered to ones the user can
// manage packs in (see CopyPackDialog's own room list below).
const Entry: React.FC<IEntryProps> = ({ room, pack, matrixClient: cli, closeSettingsFn, onFinished }) => {
    const [copyState, setCopyState] = useState<CopyState>(CopyState.CanCopy);
    const [onFocus, isActive, ref] = useRovingTabIndex<HTMLDivElement>();

    const jumpToRoom = (ev: ButtonEvent): void => {
        dis.dispatch<ViewRoomPayload>({
            action: Action.ViewRoom,
            room_id: room.roomId,
            // Haven: no dedicated analytics trigger value exists for this (an auto-generated,
            // fixed enum - see ViewRoomPayload's own metricsTrigger doc) - "Shortcut" is the
            // closest generic fit, same idea as ForwardDialog's own more specific
            // "WebForwardShortcut" for its own identical jump-to-room-and-close action.
            metricsTrigger: "Shortcut",
            metricsViaKeyboard: ev.type !== "click",
        });
        onFinished(true);
        closeSettingsFn?.();
    };
    const copy = async (): Promise<void> => {
        setCopyState(CopyState.Copying);
        try {
            await copyImagePackToRoom(cli, pack, room);
            setCopyState(CopyState.Copied);
        } catch {
            setCopyState(CopyState.Failed);
        }
    };

    let className;
    let disabled = false;
    let title;
    let icon;
    if (copyState === CopyState.CanCopy) {
        className = "mx_ForwardList_canSend";
    } else if (copyState === CopyState.Copying) {
        className = "mx_ForwardList_sending";
        disabled = true;
        title = _t("forward|sending");
        icon = <CircleIcon aria-label={title} />;
    } else if (copyState === CopyState.Copied) {
        className = "mx_ForwardList_sent";
        disabled = true;
        title = _t("room_settings|emoji_stickers|copy_pack_copied");
        icon = <CheckCircleIcon aria-label={title} />;
    } else {
        className = "mx_ForwardList_sendFailed";
        disabled = true;
        title = _t("timeline|send_state_failed");
        icon = (
            <NotificationBadge
                notification={StaticNotificationState.RED_EXCLAMATION}
                className="mx_ForwardDialog_notificationBadge"
            />
        );
    }

    const id = `mx_CopyPackDialog_entry_${room.roomId}`;
    return (
        <div
            className={`mx_ForwardList_entry ${isActive ? "mx_ForwardList_entry_active" : ""}`}
            aria-labelledby={`${id}_name`}
            aria-describedby={`${id}_copy`}
            role="listitem"
            ref={ref}
            onFocus={onFocus}
            id={id}
        >
            <AccessibleButton
                className="mx_ForwardList_roomButton"
                onClick={jumpToRoom}
                title={_t("forward|open_room")}
                placement="top"
                tabIndex={isActive ? 0 : -1}
            >
                <DecoratedRoomAvatar room={room} size="32px" tooltipProps={{ tabIndex: isActive ? 0 : -1 }} />
                <span className="mx_ForwardList_entry_name" id={`${id}_name`}>
                    {room.name}
                </span>
                <RoomContextDetails component="span" className="mx_ForwardList_entry_detail" room={room} />
            </AccessibleButton>
            <AccessibleButton
                kind={copyState === CopyState.Failed ? "danger_outline" : "primary_outline"}
                className={`mx_ForwardList_sendButton ${className}`}
                onClick={copy}
                disabled={disabled}
                title={title}
                placement="top"
                tabIndex={isActive ? 0 : -1}
                id={`${id}_copy`}
            >
                <div className="mx_ForwardList_sendLabel">{_t("action|copy")}</div>
                {icon}
            </AccessibleButton>
        </div>
    );
};

const CopyPackDialog: React.FC<IProps> = ({ matrixClient: cli, pack, closeSettingsFn, onFinished }) => {
    const userId = cli.getSafeUserId();
    const sourceRoom = cli.getRoom(pack.roomId);

    const [query, setQuery] = useState("");
    const lcQuery = query.toLowerCase();

    const msc3946DynamicRoomPredecessors = useSettingValue("feature_dynamic_room_predecessors");

    // Haven: only rooms the user can actually add a pack to at all (see canManageImagePacks) - per
    // explicit direction, not every joined room the way ForwardDialog's own list is. `eligibleRooms`
    // (pre-search) is what decides between the two empty states below: no eligible rooms anywhere
    // to copy into at all, versus a search that just didn't match any of them.
    const eligibleRooms = useMemo(
        () =>
            sortRoomsByRecency(
                cli
                    .getVisibleRooms(msc3946DynamicRoomPredecessors)
                    .filter(
                        (room) =>
                            room.getMyMembership() === KnownMembership.Join &&
                            !room.isSpaceRoom() &&
                            canManageImagePacks(room, userId),
                    ),
                userId,
            ),
        [cli, msc3946DynamicRoomPredecessors, userId],
    );

    let rooms = eligibleRooms;
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

    const onKeyDown = (ev: React.KeyboardEvent, state: IState): void => {
        let handled = true;

        const action = getKeyBindingsManager().getAccessibilityAction(ev);
        switch (action) {
            case KeyBindingAction.Enter: {
                const activeNode = state.activeNode;
                if (activeNode?.dataset.havenCopyPackSent) {
                    activeNode.querySelector<HTMLButtonElement>(".mx_ForwardList_roomButton")?.click();
                } else {
                    if (activeNode) activeNode.dataset.havenCopyPackSent = "1";
                    activeNode?.querySelector<HTMLButtonElement>(".mx_ForwardList_sendButton")?.click();
                }
                break;
            }

            default:
                handled = false;
        }

        if (handled) {
            ev.preventDefault();
            ev.stopPropagation();
        }
    };

    const imageCount = Object.keys(pack.content.images).length;

    return (
        <BaseDialog
            title={_t("room_settings|emoji_stickers|copy_pack_title")}
            className="mx_CopyPackDialog"
            contentId="mx_CopyPackDialog_list"
            onFinished={onFinished}
            fixedWidth={false}
        >
            <h3>{_t("room_settings|emoji_stickers|copy_pack_preview_heading")}</h3>
            <div className="mx_CopyPackDialog_preview">
                {sourceRoom && (
                    <PackAvatar mxcUrl={getPackAvatarMxc(pack, cli)} room={sourceRoom} size="40px" />
                )}
                <div className="mx_CopyPackDialog_previewInfo">
                    <div className="mx_CopyPackDialog_previewName">{packDisplayName(pack.content, pack.stateKey)}</div>
                    <div className="mx_CopyPackDialog_previewCount">
                        {_t("room_settings|emoji_stickers|image_count", { count: imageCount })}
                    </div>
                </div>
            </div>
            <hr />
            <RovingTabIndexProvider
                handleUpDown
                handleInputFields
                onKeyDown={onKeyDown}
                scrollIntoView={{ block: "center" }}
            >
                {({ onKeyDownHandler }) => (
                    <div className="mx_ForwardList" id="mx_CopyPackDialog_list">
                        {eligibleRooms.length > 0 && (
                            <RovingTabIndexContext.Consumer>
                                {(context) => (
                                    <SearchBox
                                        className="mx_textinput_icon mx_textinput_search"
                                        placeholder={_t("forward|filter_placeholder")}
                                        onSearch={(newQuery: string): void => {
                                            setQuery(newQuery);
                                            setTimeout(() => {
                                                const node = context.state.nodes[0];
                                                if (node) {
                                                    context.dispatch({
                                                        type: RovingStateActionType.SetFocus,
                                                        payload: { node },
                                                    });
                                                    node?.scrollIntoView?.({
                                                        block: "nearest",
                                                    });
                                                }
                                            });
                                        }}
                                        autoFocus={true}
                                        onKeyDown={onKeyDownHandler}
                                        aria-activedescendant={context.state.activeNode?.id}
                                        aria-owns="mx_CopyPackDialog_resultsList"
                                    />
                                )}
                            </RovingTabIndexContext.Consumer>
                        )}
                        <AutoHideScrollbar className="mx_AutoHideScrollbar mx_ForwardList_content">
                            {eligibleRooms.length === 0 ? (
                                <span className="mx_ForwardList_noResults">
                                    {_t("room_settings|emoji_stickers|copy_pack_no_rooms")}
                                </span>
                            ) : rooms.length > 0 ? (
                                <div className="mx_ForwardList_results">
                                    <TruncatedList
                                        id="mx_CopyPackDialog_resultsList"
                                        className="mx_ForwardList_resultsList"
                                        truncateAt={truncateAt}
                                        createOverflowElement={overflowTile}
                                        getChildren={(start, end) =>
                                            rooms
                                                .slice(start, end)
                                                .map((room) => (
                                                    <Entry
                                                        key={room.roomId}
                                                        room={room}
                                                        pack={pack}
                                                        matrixClient={cli}
                                                        closeSettingsFn={closeSettingsFn}
                                                        onFinished={onFinished}
                                                    />
                                                ))
                                        }
                                        getChildCount={() => rooms.length}
                                    />
                                </div>
                            ) : (
                                <span className="mx_ForwardList_noResults">{_t("common|no_results")}</span>
                            )}
                        </AutoHideScrollbar>
                    </div>
                )}
            </RovingTabIndexProvider>
        </BaseDialog>
    );
};

export default CopyPackDialog;

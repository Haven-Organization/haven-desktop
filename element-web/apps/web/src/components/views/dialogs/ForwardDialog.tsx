/*
Copyright 2024 New Vector Ltd.
Copyright 2021 Robin Townsend <robin@robin.town>

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useEffect, useMemo, useState } from "react";
import classnames from "classnames";
import {
    type IContent,
    MatrixEvent,
    type Room,
    type RoomMember,
    EventType,
    type MatrixClient,
    ContentHelpers,
    type ILocationContent,
    LocationAssetType,
    M_TIMESTAMP,
    M_BEACON,
    type TimelineEvents,
    MsgType,
} from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";
import { CheckCircleIcon, CircleIcon } from "@vector-im/compound-design-tokens/assets/web/icons";
import { AutoHideScrollbar } from "@element-hq/web-shared-components";

import { _t } from "../../../languageHandler";
import dis from "../../../dispatcher/dispatcher";
import { useSettingValue } from "../../../hooks/useSettings";
import { Layout } from "../../../settings/enums/Layout";
import { EventPresentationContextProvider } from "../../../utils/EventPresentationContextProvider";
import BaseDialog from "./BaseDialog";
import { avatarUrlForUser } from "../../../Avatar";
import EventTile from "../rooms/EventTile";
import SearchBox from "../../structures/SearchBox";
import DecoratedRoomAvatar from "../avatars/DecoratedRoomAvatar";
import { StaticNotificationState } from "../../../stores/notifications/StaticNotificationState";
import { NotificationBadge } from "../rooms/NotificationBadge/NotificationBadge";
import { type RoomPermalinkCreator } from "../../../utils/permalinks/Permalinks";
import { sortRoomsByRecency } from "../../../utils/room/sortRoomsByRecency";
import QueryMatcher from "../../../autocomplete/QueryMatcher";
import TruncatedList from "../elements/TruncatedList";
import { Action } from "../../../dispatcher/actions";
import { type ViewRoomPayload } from "../../../dispatcher/payloads/ViewRoomPayload";
import AccessibleButton, { type ButtonEvent } from "../elements/AccessibleButton";
import { isLocationEvent } from "../../../utils/EventUtils";
import { isSelfLocation, locationEventGeoUri } from "../../../utils/location";
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
import { attachMentions } from "../../../utils/messages";
import { CommandPartCreator } from "../../../editor/parts";
import SettingsStore from "../../../settings/SettingsStore";
import { parseEvent } from "../../../editor/deserialize";
import EditorModel from "../../../editor/model";
import StyledCheckbox from "../elements/StyledCheckbox";

const AVATAR_SIZE = 30;

interface IProps {
    matrixClient: MatrixClient;
    // The event to forward
    event: MatrixEvent;
    // We need a permalink creator for the source room to pass through to EventTile
    // in case the event is a reply (even though the user can't get at the link)
    permalinkCreator: RoomPermalinkCreator;
    onFinished(this: void): void;
    // Haven: set via Shift+clicking the Forward action on an eligible event (see
    // MessageContextMenu.tsx's onForwardClick) to pre-uncheck the Body toggle below.
    initialOmitBody?: boolean;
}

interface IEntryProps<K extends keyof TimelineEvents> {
    room: Room;
    type: K;
    content: TimelineEvents[K];
    matrixClient: MatrixClient;
    onFinished(this: void, success: boolean): void;
}

enum SendState {
    CanSend,
    Sending,
    Sent,
    Failed,
}

const Entry: React.FC<IEntryProps<any>> = ({ room, type, content, matrixClient: cli, onFinished }) => {
    const [sendState, setSendState] = useState<SendState>(SendState.CanSend);
    const [onFocus, isActive, ref] = useRovingTabIndex<HTMLDivElement>();

    const jumpToRoom = (ev: ButtonEvent): void => {
        dis.dispatch<ViewRoomPayload>({
            action: Action.ViewRoom,
            room_id: room.roomId,
            metricsTrigger: "WebForwardShortcut",
            metricsViaKeyboard: ev.type !== "click",
        });
        onFinished(true);
    };
    const send = async (): Promise<void> => {
        setSendState(SendState.Sending);
        try {
            await cli.sendEvent(room.roomId, type, content);
            setSendState(SendState.Sent);
        } catch {
            setSendState(SendState.Failed);
        }
    };

    let className;
    let disabled = false;
    let title;
    let icon;
    if (sendState === SendState.CanSend) {
        className = "mx_ForwardList_canSend";
        if (!room.maySendMessage()) {
            disabled = true;
            title = _t("forward|no_perms_title");
        }
    } else if (sendState === SendState.Sending) {
        className = "mx_ForwardList_sending";
        disabled = true;
        title = _t("forward|sending");
        icon = <CircleIcon aria-label={title} />;
    } else if (sendState === SendState.Sent) {
        className = "mx_ForwardList_sent";
        disabled = true;
        title = _t("forward|sent");
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

    const id = `mx_ForwardDialog_entry_${room.roomId}`;
    return (
        <div
            className={classnames("mx_ForwardList_entry", {
                mx_ForwardList_entry_active: isActive,
            })}
            aria-labelledby={`${id}_name`}
            aria-describedby={`${id}_send`}
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
                kind={sendState === SendState.Failed ? "danger_outline" : "primary_outline"}
                className={`mx_ForwardList_sendButton ${className}`}
                onClick={send}
                disabled={disabled}
                title={title}
                placement="top"
                tabIndex={isActive ? 0 : -1}
                id={`${id}_send`}
            >
                <div className="mx_ForwardList_sendLabel">{_t("forward|send_label")}</div>
                {icon}
            </AccessibleButton>
        </div>
    );
};

/**
 * Transform content of a MatrixEvent before forwarding:
 * 1. Strip all relations.
 * 2. Convert location events into a static pin-drop location share,
 *    and remove description from self-location shares.
 * 3. Parse the event back into an EditorModel and recalculate mentions.
 *
 * @param event - The MatrixEvent to transform.
 * @param cli - The MatrixClient (used for recalculation of mentions).
 * @returns The transformed event type and content.
 */
const transformEvent = (event: MatrixEvent, cli: MatrixClient): { type: string; content: IContent } => {
    const {
        "m.relates_to": _, // strip relations - in future we will attach a relation pointing at the original event
        // We're taking a shallow copy here to avoid https://github.com/vector-im/element-web/issues/10924
        ...content
    } = event.getContent();

    // beacon pulses get transformed into static locations on forward
    const type = M_BEACON.matches(event.getType()) ? EventType.RoomMessage : event.getType();

    // self location shares should have their description removed
    // and become 'pin' share type
    if (
        (isLocationEvent(event) && isSelfLocation(content as ILocationContent)) ||
        // beacon pulses get transformed into static locations on forward
        M_BEACON.matches(event.getType())
    ) {
        const timestamp = M_TIMESTAMP.findIn<number>(content as ILocationContent);
        const geoUri = locationEventGeoUri(event);
        return {
            type,
            content: {
                ...content,
                ...ContentHelpers.makeLocationContent(
                    undefined, // text
                    geoUri,
                    timestamp || Date.now(),
                    undefined, // description
                    LocationAssetType.Pin,
                ),
            },
        };
    }

    // Mentions can leak information about the context of the original message, so:
    // 1. Parse the event's message body back into an EditorModel, then
    // 2. Pass through attachMentions() to recalculate mentions.
    const room = cli.getRoom(event.getRoomId())!;
    const partCreator = new CommandPartCreator(room, cli);
    const parts = parseEvent(event, partCreator, {
        shouldEscape: SettingsStore.getValue("MessageComposerInput.useMarkdown"),
    });
    const model = new EditorModel(parts, partCreator); // Temporary EditorModel to pass through
    const userId = cli.getSafeUserId();
    attachMentions(userId, content, model, undefined);

    return { type, content };
};

const ATTACHMENT_MSGTYPES = [MsgType.Image, MsgType.File, MsgType.Audio, MsgType.Video];

function attachmentLabel(msgtype?: string): string {
    switch (msgtype) {
        case MsgType.Image:
            return _t("common|image");
        case MsgType.Video:
            return _t("common|video");
        case MsgType.Audio:
            return _t("common|audio");
        default:
            return _t("common|file");
    }
}

const ForwardDialog: React.FC<IProps> = ({
    matrixClient: cli,
    event,
    permalinkCreator,
    onFinished,
    initialOmitBody,
}) => {
    const userId = cli.getSafeUserId();
    // Haven: seed from the already-hydrated User object (present as soon as the client has
    // synced) instead of starting blank, so the preview shows the real name/avatar on its very
    // first render. This matters because mockEvent below is memoized on profileInfo - without a
    // synchronous seed, the async getProfileInfo() below would almost always resolve mid-render,
    // forcing mockEvent to be rebuilt and (see the mockEvent comment) restarting an in-flight
    // image load's spinner right as it was about to finish.
    const [profileInfo, setProfileInfo] = useState<{ displayname?: string; avatar_url?: string }>(() => {
        const user = cli.getUser(userId);
        return user ? { displayname: user.displayName, avatar_url: user.avatarUrl } : {};
    });
    useEffect(() => {
        void cli.getProfileInfo(userId).then((info) => {
            // Bail out (via returning the same object reference) when the fetched profile matches
            // what's already showing, so an inevitably-resolving fetch doesn't itself become a
            // second rebuild trigger for mockEvent in the common case where nothing changed.
            setProfileInfo((prev) =>
                prev.displayname === info.displayname && prev.avatar_url === info.avatar_url ? prev : info,
            );
        });
    }, [cli, userId]);

    // Haven: memoized so its identity is stable across re-renders (e.g. the profileInfo fetch
    // below resolving mid-load). ImageBodyViewModel treats a new mxEvent reference as a brand new
    // image and resets its loaded state - since the underlying <img> src string doesn't actually
    // change, the browser never re-fires its load event, and the preview's spinner would get
    // stuck forever waiting for a load signal that's never coming again.
    const { type, content } = useMemo(() => transformEvent(event, cli), [event, cli]);

    // Haven: an attachment event only has a genuine caption - as opposed to body just holding
    // the filename, per the convention MessageEvent.tsx's own hasCaption check relies on - when
    // it carries a separate filename field that differs from body. Only then is there anything
    // meaningful to toggle between forwarding the file, the caption, or both.
    const msgtype = content.msgtype as string | undefined;
    const hasCaption = !!content.filename && content.filename !== content.body;
    const showAttachmentToggle = !!msgtype && ATTACHMENT_MSGTYPES.includes(msgtype as MsgType) && hasCaption;

    const [includeBody, setIncludeBody] = useState(!(showAttachmentToggle && initialOmitBody));
    const [includeAttachment, setIncludeAttachment] = useState(true);

    const onToggleBody = (): void => {
        if (includeBody) {
            setIncludeBody(false);
            setIncludeAttachment(true);
        } else {
            setIncludeBody(true);
        }
    };
    const onToggleAttachment = (): void => {
        if (includeAttachment) {
            setIncludeAttachment(false);
            setIncludeBody(true);
        } else {
            setIncludeAttachment(true);
        }
    };

    // Haven: StyledCheckbox's own DOM (a small checkbox glyph plus a <label for=...> wrapping just
    // the text) only fills part of the pill-shaped, padded/bordered box these two options are
    // actually styled as (see _ForwardDialog.pcss's own mx_ForwardDialog_attachmentOption) - a
    // click anywhere in that box's own padding was a dead click, only the checkbox/label text
    // itself registered. Wiring the same toggle onto the outer box's own onClick fixes that, but
    // needs to skip when the click's real target IS the checkbox or its label: those already
    // trigger the identical toggle via the browser's native <label for> behavior, and a click on
    // them still bubbles up to this outer handler - calling toggle twice in the same event tick
    // would cancel out (both calls read the same pre-toggle state, since neither's setState has
    // re-rendered yet) rather than doing nothing extra as intended.
    const onOptionClick = (toggle: () => void, disabled: boolean) => (ev: React.MouseEvent): void => {
        if (disabled) return;
        if ((ev.target as HTMLElement).closest("input, label")) return;
        toggle();
    };

    const { type: effectiveType, content: effectiveContent } = useMemo((): { type: string; content: IContent } => {
        if (!showAttachmentToggle || (includeBody && includeAttachment)) {
            return { type, content };
        }
        if (!includeAttachment) {
            // Body-only: drop the attachment and become a plain text message.
            const { msgtype: _msgtype, url, file, info, filename, thumbnail_url, thumbnail_file, ...rest } =
                content as IContent & { thumbnail_url?: unknown; thumbnail_file?: unknown };
            return { type, content: { ...rest, msgtype: MsgType.Text } };
        }
        // Attachment-only: drop the caption, but body must still hold something for legacy
        // clients that don't understand the filename field, so reuse the filename as the body.
        const { formatted_body, format, filename, ...rest } = content;
        return { type, content: { ...rest, body: filename ?? content.body } };
    }, [type, content, showAttachmentToggle, includeBody, includeAttachment]);

    // For the message preview we fake the sender as ourselves. Memoized for the same reason as
    // transformEvent above - the identity must stay stable while effectiveContent/profileInfo are
    // unchanged, since EventTile's shouldComponentUpdate shallow-compares mxEvent by reference and
    // won't re-render (so a mutated .sender would never be picked up) if it doesn't change.
    const mockEvent = useMemo(() => {
        const mxEvent = new MatrixEvent({
            type: "m.room.message",
            sender: userId,
            content: effectiveContent,
            unsigned: {
                age: 97,
            },
            event_id: "$9999999999999999999999999999999999999999999",
            room_id: event.getRoomId(),
            origin_server_ts: event.getTs(),
        });
        mxEvent.sender = {
            name: profileInfo.displayname || userId,
            rawDisplayName: profileInfo.displayname,
            userId,
            getAvatarUrl: (..._) => {
                return avatarUrlForUser({ avatarUrl: profileInfo.avatar_url }, AVATAR_SIZE, AVATAR_SIZE, "crop");
            },
            getMxcAvatarUrl: () => profileInfo.avatar_url,
        } as RoomMember;
        return mxEvent;
    }, [effectiveContent, event, userId, profileInfo]);

    const [query, setQuery] = useState("");
    const lcQuery = query.toLowerCase();

    const previewLayout = useSettingValue("layout");
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
                // Haven: once Enter has sent a room's forward, a second Enter should navigate there
                // instead of re-clicking the now-disabled send button (a dead click). Reading the
                // button's own `disabled`/class state isn't reliable for this: that only reflects
                // whatever React has committed so far, and two Enters fired back to back can both be
                // handled before React ever re-renders in between. This flag is a plain synchronous
                // DOM mutation instead - set the instant the first Enter is handled, so it's visible
                // to a second Enter immediately, independent of any render timing.
                if (activeNode?.dataset.havenForwardSent) {
                    activeNode.querySelector<HTMLButtonElement>(".mx_ForwardList_roomButton")?.click();
                } else {
                    if (activeNode) activeNode.dataset.havenForwardSent = "1";
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

    return (
        <BaseDialog
            title={_t("common|forward_message")}
            className="mx_ForwardDialog"
            contentId="mx_ForwardList"
            onFinished={onFinished}
            fixedWidth={false}
        >
            <h3>{_t("forward|message_preview_heading")}</h3>
            <div
                className={classnames("mx_ForwardDialog_preview", {
                    mx_IRCLayout: previewLayout == Layout.IRC,
                })}
            >
                <EventPresentationContextProvider layout={previewLayout}>
                    <EventTile
                        mxEvent={mockEvent}
                        layout={previewLayout}
                        permalinkCreator={permalinkCreator}
                        as="div"
                        inhibitInteraction
                    />
                </EventPresentationContextProvider>
            </div>
            {showAttachmentToggle && (
                <div className="mx_ForwardDialog_attachmentOptions">
                    <div
                        className={classnames("mx_ForwardDialog_attachmentOption", {
                            mx_ForwardDialog_attachmentOption_disabled: !includeAttachment,
                        })}
                        onClick={onOptionClick(onToggleBody, !includeAttachment)}
                    >
                        <StyledCheckbox checked={includeBody} disabled={!includeAttachment} onChange={onToggleBody}>
                            {_t("forward|body_label")}
                        </StyledCheckbox>
                    </div>
                    <div
                        className={classnames("mx_ForwardDialog_attachmentOption", {
                            mx_ForwardDialog_attachmentOption_disabled: !includeBody,
                        })}
                        onClick={onOptionClick(onToggleAttachment, !includeBody)}
                    >
                        <StyledCheckbox
                            checked={includeAttachment}
                            disabled={!includeBody}
                            onChange={onToggleAttachment}
                        >
                            {attachmentLabel(msgtype)}
                        </StyledCheckbox>
                    </div>
                </div>
            )}
            <hr />
            <RovingTabIndexProvider
                handleUpDown
                handleInputFields
                onKeyDown={onKeyDown}
                scrollIntoView={{ block: "center" }}
            >
                {({ onKeyDownHandler }) => (
                    <div className="mx_ForwardList" id="mx_ForwardList">
                        <RovingTabIndexContext.Consumer>
                            {(context) => (
                                <SearchBox
                                    className="mx_textinput_icon mx_textinput_search"
                                    placeholder={_t("forward|filter_placeholder")}
                                    onSearch={(query: string): void => {
                                        setQuery(query);
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
                                    aria-owns="mx_ForwardDialog_resultsList"
                                />
                            )}
                        </RovingTabIndexContext.Consumer>
                        <AutoHideScrollbar className="mx_AutoHideScrollbar mx_ForwardList_content">
                            {rooms.length > 0 ? (
                                <div className="mx_ForwardList_results">
                                    <TruncatedList
                                        id="mx_ForwardDialog_resultsList"
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
                                                        type={effectiveType}
                                                        content={effectiveContent}
                                                        matrixClient={cli}
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

export default ForwardDialog;

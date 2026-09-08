/*
Copyright 2024,2025 New Vector Ltd.
Copyright 2021 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { useEffect, useState } from "react";
import { logger } from "matrix-js-sdk/src/logger";
import {
    type MatrixClient,
    type RoomMember,
    type Room,
    type MatrixEvent,
    EventTimeline,
    EventType,
} from "matrix-js-sdk/src/matrix";

import { _t } from "../../../languageHandler";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import BaseDialog from "../dialogs/BaseDialog";
import InfoDialog from "../dialogs/InfoDialog";
import DialogButtons from "../elements/DialogButtons";
import StyledCheckbox from "../elements/StyledCheckbox";
import StyledRadioGroup from "../elements/StyledRadioGroup";
import Field from "../elements/Field";
import InlineSpinner from "../elements/InlineSpinner";

interface Props {
    matrixClient: MatrixClient;
    room: Room;
    member: RoomMember;
    onFinished(this: void, redact?: boolean): void;
}

/** Haven: events this dialog will never offer to redact, regardless of mode - unchanged from this
 *  dialog's own original filter. */
const EXCLUDED_TYPES = new Set<string>([EventType.RoomCreate, EventType.RoomServerAcl, EventType.RoomEncryption]);

function isRedactableSenderEvent(event: MatrixEvent, userId: string): boolean {
    return (
        event.getSender() === userId &&
        !event.isRedacted() &&
        !event.isRedaction() &&
        // Don't redact ACLs because that'll obliterate the room
        // See https://github.com/matrix-org/synapse/issues/4042 for details.
        // Redacting encryption events is equally bad.
        !EXCLUDED_TYPES.has(event.getType())
    );
}

/** Haven: gathers every one of `userId`'s redactable events already loaded into memory for this
 *  room, across every backward-linked timeline segment - this dialog's own original (and only)
 *  behaviour before "Custom" mode existed below. Never fetches anything from the homeserver, so
 *  how far back it reaches depends entirely on how much of the room the client happened to have
 *  already synced/paginated through for other reasons. */
function gatherLoadedEvents(room: Room, userId: string): MatrixEvent[] {
    let timeline: EventTimeline | null = room.getLiveTimeline();
    let events: MatrixEvent[] = [];
    while (timeline) {
        events = [...events, ...timeline.getEvents().filter((event) => isRedactableSenderEvent(event, userId))];
        timeline = timeline.getNeighbouringTimeline(EventTimeline.BACKWARDS);
    }
    return events;
}

// Haven: hard ceilings on the "Custom" mode search below, so a user with sparse matching messages
// in a very long room can't spin the loop (and the homeserver requests it makes) forever.
const MAX_PAGINATION_ITERATIONS = 50;
const PAGINATION_PAGE_SIZE = 100;
// Haven: real network round-trips per keystroke would be wasteful and janky - only actually start
// paginating once the user has paused typing for this long.
const SEARCH_DEBOUNCE_MS = 400;

type Mode = "recent" | "custom";

/** Haven: actively paginates `room`'s timeline backward via the homeserver (not just already-loaded
 *  timeline segments - see gatherLoadedEvents's own doc on why that's not enough for "Custom" mode's
 *  whole point) until at least `wanted` of `userId`'s redactable events have been found, or the
 *  start of the room's history is reached, or MAX_PAGINATION_ITERATIONS is hit. `keepStateEvents`
 *  is applied as part of the search itself (not filtered afterward) so the search keeps going until
 *  it finds `wanted` messages that actually match what will be redacted. */
async function searchBackForEvents(
    cli: MatrixClient,
    room: Room,
    userId: string,
    wanted: number,
    keepStateEvents: boolean,
    isCancelled: () => boolean,
): Promise<{ events: MatrixEvent[]; reachedRoomStart: boolean }> {
    const timeline = room.getLiveTimeline();
    const seenEventIds = new Set<string>();
    const matched: MatrixEvent[] = [];
    let reachedRoomStart = false;

    for (let i = 0; i < MAX_PAGINATION_ITERATIONS && matched.length < wanted; i++) {
        if (isCancelled()) break;
        for (const event of timeline.getEvents()) {
            const id = event.getId();
            if (!id || seenEventIds.has(id)) continue;
            seenEventIds.add(id);
            if (isRedactableSenderEvent(event, userId) && !(keepStateEvents && event.isState())) {
                matched.push(event);
            }
        }
        if (matched.length >= wanted || isCancelled()) break;

        let more: boolean;
        try {
            more = await cli.paginateEventTimeline(timeline, { backwards: true, limit: PAGINATION_PAGE_SIZE });
        } catch (err) {
            logger.error("BulkRedactDialog: pagination failed while searching for messages to redact", err);
            more = false;
        }
        if (!more) {
            reachedRoomStart = true;
            break;
        }
    }

    matched.sort((a, b) => b.getTs() - a.getTs());
    return { events: matched, reachedRoomStart };
}

const BulkRedactDialog: React.FC<Props> = (props) => {
    const { matrixClient: cli, room, member, onFinished } = props;

    const allLoadedEvents = gatherLoadedEvents(room, member.userId);

    const [keepStateEvents, setKeepStateEvents] = useState(true);
    // Haven: "Recent" (this dialog's own original, only-ever behaviour) vs "Custom" - see this
    // component's own module-level doc for why "Recent" alone can silently redact far fewer
    // messages than a user asks for (it never fetches more history than whatever's already
    // loaded), which is exactly what "Custom" mode's active backward pagination fixes.
    const [mode, setMode] = useState<Mode>("recent");
    // Haven: always a real number, for both "remove my own messages" and "remove someone else's"
    // - blank/zero has no sensible meaning once "unlimited" is its own separate "Recent" mode
    // instead of the field's own empty state.
    const [customCountInput, setCustomCountInput] = useState("25");
    const [customEvents, setCustomEvents] = useState<MatrixEvent[] | null>(null);
    const [isSearching, setIsSearching] = useState(false);
    const [reachedRoomStart, setReachedRoomStart] = useState(false);

    const parsedCustomCount = (() => {
        const n = parseInt(customCountInput, 10);
        return Number.isFinite(n) && n > 0 ? n : null;
    })();

    useEffect(() => {
        if (mode !== "custom" || parsedCustomCount === null) {
            setCustomEvents(null);
            setIsSearching(false);
            setReachedRoomStart(false);
            return;
        }

        let cancelled = false;
        setIsSearching(true);
        const timeoutId = window.setTimeout(() => {
            void searchBackForEvents(cli, room, member.userId, parsedCustomCount, keepStateEvents, () => cancelled).then(
                (result) => {
                    if (cancelled) return;
                    setCustomEvents(result.events);
                    setReachedRoomStart(result.reachedRoomStart);
                    setIsSearching(false);
                },
            );
        }, SEARCH_DEBOUNCE_MS);

        return () => {
            cancelled = true;
            window.clearTimeout(timeoutId);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, parsedCustomCount, keepStateEvents, cli, room, member.userId]);

    if (allLoadedEvents.length === 0) {
        return (
            <InfoDialog
                onFinished={onFinished}
                title={_t("user_info|redact|no_recent_messages_title", { user: member.name })}
                description={
                    <div>
                        <p>{_t("user_info|redact|no_recent_messages_description")}</p>
                    </div>
                }
            />
        );
    } else {
        const recentEligibleEvents = allLoadedEvents.filter((event) => !(keepStateEvents && event.isState()));
        const searching = mode === "custom" && isSearching;
        const eventsToRedact =
            mode === "custom" ? (customEvents ?? []).slice(0, parsedCustomCount ?? 0) : recentEligibleEvents;
        const count = eventsToRedact.length;
        const user = member.name;

        const redact = async (): Promise<void> => {
            logger.info(`Started redacting recent ${count} messages for ${member.userId} in ${room.roomId}`);
            dis.dispatch({
                action: Action.BulkRedactStart,
                room_id: room.roomId,
            });

            // Submitting a large number of redactions freezes the UI,
            // so first yield to allow to rerender after closing the dialog.
            await Promise.resolve();
            await Promise.all(
                eventsToRedact.reverse().map(async (event): Promise<void> => {
                    try {
                        await cli.redactEvent(room.roomId, event.getId()!);
                    } catch (err) {
                        // log and swallow errors
                        logger.error("Could not redact", event.getId());
                        logger.error(err);
                    }
                }),
            );

            logger.info(`Finished redacting recent ${count} messages for ${member.userId} in ${room.roomId}`);
            dis.dispatch({
                action: Action.BulkRedactEnd,
                room_id: room.roomId,
            });
        };

        return (
            <BaseDialog
                className="mx_BulkRedactDialog"
                onFinished={onFinished}
                title={_t("user_info|redact|confirm_title", { user })}
                contentId="mx_Dialog_content"
            >
                <div className="mx_Dialog_content" id="mx_Dialog_content">
                    {searching && (
                        <p className="mx_BulkRedactDialog_searching">
                            <InlineSpinner size={16} /> {_t("user_info|redact|searching_status", { user })}
                        </p>
                    )}
                    <p>{_t("user_info|redact|confirm_description_2")}</p>
                    <StyledRadioGroup<Mode>
                        name="mx_BulkRedactDialog_mode"
                        value={mode}
                        onChange={setMode}
                        definitions={[
                            {
                                value: "recent",
                                label: _t("user_info|redact|mode_recent_label"),
                                description: _t("user_info|redact|mode_recent_description"),
                            },
                            {
                                value: "custom",
                                label: _t("user_info|redact|mode_custom_label"),
                                description: _t("user_info|redact|mode_custom_description"),
                            },
                        ]}
                    />
                    <Field
                        id="mx_BulkRedactDialog_limit"
                        element="input"
                        type="number"
                        min={1}
                        value={customCountInput}
                        label={_t("user_info|redact|limit_label")}
                        disabled={mode !== "custom"}
                        onChange={(e) => setCustomCountInput(e.target.value)}
                    />
                    {mode === "custom" && !isSearching && reachedRoomStart && (
                        <p className="mx_BulkRedactDialog_reachedStart">
                            {_t("user_info|redact|reached_start_of_room", { count: customEvents?.length ?? 0 })}
                        </p>
                    )}
                    <StyledCheckbox
                        description={_t("user_info|redact|confirm_keep_state_explainer")}
                        checked={keepStateEvents}
                        onChange={(e) => setKeepStateEvents(e.target.checked)}
                    >
                        {_t("user_info|redact|confirm_keep_state_label")}
                    </StyledCheckbox>
                </div>
                <DialogButtons
                    primaryButton={_t("user_info|redact|confirm_button", { count })}
                    primaryButtonClass="danger"
                    primaryDisabled={count === 0 || (mode === "custom" && (parsedCustomCount === null || searching))}
                    onPrimaryButtonClick={() => {
                        setTimeout(redact, 0);
                        onFinished(true);
                    }}
                    onCancel={() => onFinished(false)}
                />
            </BaseDialog>
        );
    }
};

export default BulkRedactDialog;

/*
 * Haven: lists the rooms the current user shares with another user, opened from the "Mutual
 * Rooms" button in the user info panel. Searchable by name, alias and room ID; rows are rendered
 * a page at a time as the list scrolls, so a very long list isn't built all at once.
 */

import React, { type JSX, useEffect, useMemo, useRef, useState } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";
import { AutoHideScrollbar } from "@element-hq/web-shared-components";

import { _t } from "../../../languageHandler";
import BaseDialog from "./BaseDialog";
import SearchBox from "../../structures/SearchBox";
import RoomAvatar from "../avatars/RoomAvatar";
import AccessibleButton from "../elements/AccessibleButton";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type ViewRoomPayload } from "../../../dispatcher/payloads/ViewRoomPayload";
import { mutualRoomMatches } from "../../../utils/MutualRooms";

/** How many rows are rendered at first, and added each time the end of the list scrolls into view. */
export const MUTUAL_ROOMS_PAGE_SIZE = 50;

interface Props {
    /** The mutual rooms, already sorted. */
    rooms: Room[];
    onFinished(): void;
}

function MutualRoomRow({ room, onFinished }: { room: Room; onFinished(): void }): JSX.Element {
    const alias = room.getCanonicalAlias() ?? room.getAltAliases()[0];
    const onClick = (): void => {
        dis.dispatch<ViewRoomPayload>({
            action: Action.ViewRoom,
            room_id: room.roomId,
            metricsTrigger: undefined,
        });
        onFinished();
    };

    return (
        <li>
            <AccessibleButton className="mx_MutualRoomsDialog_row" onClick={onClick}>
                <RoomAvatar room={room} size="32px" />
                <div className="mx_MutualRoomsDialog_rowText">
                    <span className="mx_MutualRoomsDialog_rowName">{room.name}</span>
                    <span className="mx_MutualRoomsDialog_rowId">{alias ?? room.roomId}</span>
                </div>
            </AccessibleButton>
        </li>
    );
}

export default function MutualRoomsDialog({ rooms, onFinished }: Props): JSX.Element {
    const [query, setQuery] = useState("");
    const [shownCount, setShownCount] = useState(MUTUAL_ROOMS_PAGE_SIZE);
    const sentinelRef = useRef<HTMLLIElement>(null);

    const matching = useMemo(() => rooms.filter((room) => mutualRoomMatches(room, query)), [rooms, query]);
    const shown = matching.slice(0, shownCount);
    const hasMore = shown.length < matching.length;

    // A new search starts again from the first page
    useEffect(() => setShownCount(MUTUAL_ROOMS_PAGE_SIZE), [query]);

    // Render the next page once the end of the list scrolls into view
    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!hasMore || !sentinel || typeof IntersectionObserver === "undefined") return;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                setShownCount((count) => count + MUTUAL_ROOMS_PAGE_SIZE);
            }
        });
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [hasMore, shownCount]);

    return (
        <BaseDialog
            title={_t("user_info|mutual_rooms_title")}
            className="mx_MutualRoomsDialog"
            contentId="mx_MutualRoomsDialog_list"
            onFinished={onFinished}
            fixedWidth={false}
        >
            <SearchBox
                className="mx_textinput_icon mx_textinput_search"
                placeholder={_t("user_info|mutual_rooms_search")}
                onSearch={setQuery}
                autoFocus={true}
            />
            <AutoHideScrollbar className="mx_MutualRoomsDialog_content">
                {matching.length === 0 ? (
                    <span className="mx_MutualRoomsDialog_noResults">{_t("common|no_results")}</span>
                ) : (
                    <ul className="mx_MutualRoomsDialog_list" id="mx_MutualRoomsDialog_list">
                        {shown.map((room) => (
                            <MutualRoomRow key={room.roomId} room={room} onFinished={onFinished} />
                        ))}
                        {hasMore && <li ref={sentinelRef} className="mx_MutualRoomsDialog_sentinel" aria-hidden />}
                    </ul>
                )}
            </AutoHideScrollbar>
        </BaseDialog>
    );
}

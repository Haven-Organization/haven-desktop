/*
 * Social Overlay — FeedFilterDialog
 *
 * Modal for editing the Feed's room-type/room/user filters (see utils/socialFeedFilter.ts). Four
 * pill-based sections: extra room types to include, specific rooms to include regardless of type,
 * rooms to exclude, and users to exclude. The room/user sections use the exact stock `#`/`@`
 * autocomplete (RoomProvider/UserProvider) via PillMultiInput.
 */

import React, { type JSX, useCallback, useEffect, useMemo, useState } from "react";
import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

import BaseDialog from "../../../../element-web/apps/web/src/components/views/dialogs/BaseDialog";
import MatrixClientContext from "../../../../element-web/apps/web/src/contexts/MatrixClientContext";
import RoomProvider from "../../../../element-web/apps/web/src/autocomplete/RoomProvider";
import UserProvider from "../../../../element-web/apps/web/src/autocomplete/UserProvider";
import {
    type SocialFeedFilter,
    saveSocialFeedFilter,
    isValidRoomType,
    isValidRoomIdOrAlias,
    isValidUserId,
} from "../utils/socialFeedFilter";
import { PillMultiInput, type FilterPill } from "./PillMultiInput";
import socialIcon from "../assets/social-icon.png";

const SOCIAL_ROOMS_PILL_KEY = "locked-social-rooms";

interface Props {
    client: MatrixClient;
    rooms: Room[];
    filter: SocialFeedFilter;
    onFinished: (saved?: boolean) => void;
}

function pillsFromValues(values: string[]): FilterPill[] {
    return values.map((value, i) => ({ key: `${value}-${i}`, value, label: value }));
}

export function FeedFilterDialog({ client, rooms, filter, onFinished }: Props): JSX.Element {
    const [roomTypePills, setRoomTypePills] = useState<FilterPill[]>(() => [
        {
            key: SOCIAL_ROOMS_PILL_KEY,
            value: SOCIAL_ROOMS_PILL_KEY,
            label: "Social Rooms",
            locked: true,
            icon: <img src={socialIcon} alt="" className="social_PillMultiInput_pill_avatarImg" />,
        },
        ...pillsFromValues(filter.extraRoomTypes),
    ]);
    const [includedRoomPills, setIncludedRoomPills] = useState<FilterPill[]>(() =>
        pillsFromValues(filter.includedRoomIds),
    );
    const [excludedRoomPills, setExcludedRoomPills] = useState<FilterPill[]>(() =>
        pillsFromValues(filter.excludedRoomIds),
    );
    const [excludedUserPills, setExcludedUserPills] = useState<FilterPill[]>(() =>
        pillsFromValues(filter.excludedUserIds),
    );
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    // RoomProvider/UserProvider need *some* Room to construct against — RoomProvider's own search
    // is global (see its getCompletions, which pulls from client.getVisibleRooms()), and this is
    // the same room-scoping the stock message composer itself already has for its member
    // autocomplete, so using any one joined room here matches "the same logic used in the stock
    // message composer" rather than reimplementing a bespoke global user search.
    const anchorRoom = useMemo(() => rooms.find((r) => r.getMyMembership() === "join") ?? rooms[0], [rooms]);
    const roomProvider = useMemo(() => (anchorRoom ? new RoomProvider(anchorRoom) : undefined), [anchorRoom]);
    const userProvider = useMemo(() => (anchorRoom ? new UserProvider(anchorRoom) : undefined), [anchorRoom]);
    useEffect(() => {
        return () => userProvider?.destroy();
    }, [userProvider]);

    const handleSave = useCallback(async () => {
        const badRoomTypes = roomTypePills.filter((p) => !p.locked && !isValidRoomType(p.value));
        const badIncludedRooms = includedRoomPills.filter((p) => !isValidRoomIdOrAlias(p.value));
        const badRooms = excludedRoomPills.filter((p) => !isValidRoomIdOrAlias(p.value));
        const badUsers = excludedUserPills.filter((p) => !isValidUserId(p.value));
        const conflicting = includedRoomPills.filter((p) => excludedRoomPills.some((e) => e.value === p.value));

        if (badRoomTypes.length || badIncludedRooms.length || badRooms.length || badUsers.length || conflicting.length) {
            const parts: string[] = [];
            if (badRoomTypes.length) {
                parts.push(
                    `Include these room types in feed: ${badRoomTypes.map((p) => `"${p.value}"`).join(", ")} — room types can't contain spaces.`,
                );
            }
            if (badIncludedRooms.length) {
                parts.push(
                    `Include these rooms in feed: ${badIncludedRooms.map((p) => `"${p.value}"`).join(", ")} — must be a room ID (!id:server) or alias (#alias:server).`,
                );
            }
            if (badRooms.length) {
                parts.push(
                    `Filter rooms from feed: ${badRooms.map((p) => `"${p.value}"`).join(", ")} — must be a room ID (!id:server) or alias (#alias:server).`,
                );
            }
            if (badUsers.length) {
                parts.push(
                    `Filter users from feed: ${badUsers.map((p) => `"${p.value}"`).join(", ")} — must be a user ID (@user:server).`,
                );
            }
            if (conflicting.length) {
                parts.push(
                    `${conflicting.map((p) => `"${p.value}"`).join(", ")} can't be in both "Include these rooms in feed" and "Filter rooms from feed".`,
                );
            }
            setError(parts.join(" "));
            return;
        }

        setError(null);
        setBusy(true);
        try {
            const newFilter: SocialFeedFilter = {
                extraRoomTypes: roomTypePills.filter((p) => !p.locked).map((p) => p.value),
                includedRoomIds: includedRoomPills.map((p) => p.value),
                excludedRoomIds: excludedRoomPills.map((p) => p.value),
                excludedUserIds: excludedUserPills.map((p) => p.value),
            };
            await saveSocialFeedFilter(client, newFilter);
            onFinished(true);
        } finally {
            setBusy(false);
        }
    }, [client, roomTypePills, includedRoomPills, excludedRoomPills, excludedUserPills, onFinished]);

    return (
        <MatrixClientContext.Provider value={client}>
            <BaseDialog
                className="social_FeedFilterDialog"
                title="Feed filters"
                hasCancel
                onFinished={() => onFinished(false)}
            >
                <div className="social_FeedFilterDialog_section">
                    <div className="social_FeedFilterDialog_sectionHeader">Include these room types in feed</div>
                    <PillMultiInput
                        pills={roomTypePills}
                        onChange={setRoomTypePills}
                        placeholder="Add a room type…"
                    />
                </div>

                <div className="social_FeedFilterDialog_section">
                    <div className="social_FeedFilterDialog_sectionHeader">Include these rooms in feed</div>
                    <PillMultiInput
                        pills={includedRoomPills}
                        onChange={setIncludedRoomPills}
                        placeholder="#room:example.org"
                        autocomplete={roomProvider ? { trigger: "#", provider: roomProvider } : undefined}
                        kind="room"
                    />
                </div>

                <div className="social_FeedFilterDialog_section">
                    <div className="social_FeedFilterDialog_sectionHeader">Filter rooms from feed</div>
                    <PillMultiInput
                        pills={excludedRoomPills}
                        onChange={setExcludedRoomPills}
                        placeholder="#room:example.org"
                        autocomplete={roomProvider ? { trigger: "#", provider: roomProvider } : undefined}
                        kind="room"
                    />
                </div>

                <div className="social_FeedFilterDialog_section">
                    <div className="social_FeedFilterDialog_sectionHeader">Filter users from feed</div>
                    <PillMultiInput
                        pills={excludedUserPills}
                        onChange={setExcludedUserPills}
                        placeholder="@user:example.org"
                        autocomplete={userProvider ? { trigger: "@", provider: userProvider } : undefined}
                        kind="user"
                    />
                </div>

                {error && <p className="social_Error social_FeedFilterDialog_error">{error}</p>}

                <div className="social_FeedFilterDialog_footer">
                    <button
                        type="button"
                        className="social_ActionBtn"
                        onClick={() => onFinished(false)}
                        disabled={busy}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="social_ActionBtn social_ActionBtn--primary"
                        onClick={() => void handleSave()}
                        disabled={busy}
                    >
                        Save
                    </button>
                </div>
            </BaseDialog>
        </MatrixClientContext.Provider>
    );
}

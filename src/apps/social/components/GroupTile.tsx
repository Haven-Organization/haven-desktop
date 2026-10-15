/*
 * Social Overlay - GroupTile
 *
 * The group card shown in the Groups section's grid, and in the Search section's Groups tab for
 * groups found in a room directory. Both render the same GroupCard; GroupTile reads a joined
 * Room, DirectoryGroupTile a room directory entry (which has no banner).
 */

import React, { type JSX } from "react";
import { type IPublicRoomsChunkRoom, type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

import RoomAvatar from "../../../../element-web/apps/web/src/components/views/avatars/RoomAvatar";
import BaseAvatar from "../../../../element-web/apps/web/src/components/views/avatars/BaseAvatar";
import { ROOM_BANNER_EVENT_TYPE } from "../utils/room-classifier";

function GroupCard({
    avatar,
    bannerHttpUrl,
    name,
    topic,
    memberCount,
    onClick,
}: {
    avatar: JSX.Element;
    bannerHttpUrl: string | null;
    name: string;
    topic: string;
    memberCount: number;
    onClick: () => void;
}): JSX.Element {
    return (
        <button type="button" className="social_GroupTile" onClick={onClick}>
            <div className="social_GroupTile_banner">
                {bannerHttpUrl && <img src={bannerHttpUrl} alt="" aria-hidden />}
            </div>
            <div className="social_GroupTile_avatarWrap">{avatar}</div>
            <div className="social_GroupTile_info">
                <div className="social_GroupTile_name">{name}</div>
                {topic && <div className="social_GroupTile_topic">{topic}</div>}
                <div className="social_GroupTile_meta">{memberCount} members</div>
            </div>
        </button>
    );
}

export function GroupTile({
    room,
    client,
    onView,
}: {
    room: Room;
    client: MatrixClient;
    onView: (id: string) => void;
}): JSX.Element {
    const topic: string = room.currentState.getStateEvents("m.room.topic", "")?.getContent().topic ?? "";
    const bannerMxc: string | undefined = room.currentState
        .getStateEvents(ROOM_BANNER_EVENT_TYPE, "")
        ?.getContent()?.url;
    const bannerHttpUrl = bannerMxc ? client.mxcUrlToHttp(bannerMxc) : null;

    return (
        <GroupCard
            avatar={<RoomAvatar room={room} size="72px" />}
            bannerHttpUrl={bannerHttpUrl}
            name={room.name}
            topic={topic}
            memberCount={room.getJoinedMemberCount()}
            onClick={() => onView(room.roomId)}
        />
    );
}

export function DirectoryGroupTile({
    entry,
    client,
    onView,
}: {
    entry: IPublicRoomsChunkRoom;
    client: MatrixClient;
    onView: (entry: IPublicRoomsChunkRoom) => void;
}): JSX.Element {
    const name = entry.name ?? entry.canonical_alias ?? entry.room_id;
    const avatarUrl = entry.avatar_url ? (client.mxcUrlToHttp(entry.avatar_url, 72, 72, "crop") ?? undefined) : undefined;

    return (
        <GroupCard
            avatar={<BaseAvatar name={name} idName={entry.room_id} url={avatarUrl} size="72px" />}
            bannerHttpUrl={null}
            name={name}
            topic={entry.topic ?? ""}
            memberCount={entry.num_joined_members}
            onClick={() => onView(entry)}
        />
    );
}

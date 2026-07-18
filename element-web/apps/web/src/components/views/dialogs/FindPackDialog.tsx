/*
 * Haven: MSC4459 (Image pack references) — "Find Pack" dialog.
 *
 * Opened from MessageContextMenu's own "Find Pack" option, which appears whenever an event carries
 * an image_source_packs reference (a sticker, a text message with an inline custom emoji, or - via
 * ReactionsRowButton - a custom emoji reaction). This is the "client uses references to let the
 * user find the pack" half of MSC4459's implementation requirements - the "client sends references"
 * half lives in utils/imageSourcePacks.ts's own buildImageSourcePacks/buildImageSourcePacksFromModel.
 *
 * Three states: the referenced room isn't joined yet (offer to preview it - MSC4459 only ever
 * references public/knockable rooms, so a preview should always be possible); the room is joined
 * but the pack itself is gone (state can't truly be deleted in Matrix, but an empty pack counts as
 * deleted - see ImagePacks.ts's own doc); or the pack is still there, in which case this shows the
 * same avatar/name/room summary as AddToPackDialog's own rows, plus buttons to view it (the shared
 * PackEditor, permission-aware) or toggle favouriting it.
 */

import React, { type JSX, useCallback, useMemo, useState } from "react";

import BaseDialog from "./BaseDialog";
import { _t } from "../../../languageHandler";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type ViewRoomPayload } from "../../../dispatcher/payloads/ViewRoomPayload";
import AccessibleButton from "../elements/AccessibleButton";
import Spinner from "../elements/Spinner";
import { type ImageSourcePackRef } from "../../../utils/imageSourcePacks";
import {
    type RoomImagePack,
    getRoomImagePacks,
    getPackAvatarMxc,
    packDisplayName,
    canManageImagePacks,
    isPackFavorited,
    getFavoritePackRefs,
    setFavoritePackRefs,
} from "../../../utils/ImagePacks";
import { PackEditor, PackAvatar } from "../settings/emojistickers/PackEditor";

interface Props {
    packRef: ImageSourcePackRef;
    onFinished: () => void;
}

export default function FindPackDialog({ packRef, onFinished }: Props): JSX.Element {
    const client = MatrixClientPeg.safeGet();
    const myUserId = client.getSafeUserId();
    const room = client.getRoom(packRef.room_id);
    const pack = useMemo<RoomImagePack | undefined>(() => {
        if (!room) return undefined;
        return getRoomImagePacks(room).find((p) => p.stateKey === packRef.state_key);
    }, [room, packRef.state_key]);

    const [viewing, setViewing] = useState(false);
    const [favorited, setFavorited] = useState(() => isPackFavorited(client, packRef.room_id, packRef.state_key));
    const [busy, setBusy] = useState(false);

    const handlePreviewRoom = useCallback((): void => {
        dis.dispatch<ViewRoomPayload>({
            action: Action.ViewRoom,
            room_id: packRef.room_id,
            via_servers: packRef.via ?? [],
            should_peek: true,
            metricsTrigger: undefined,
        });
        onFinished();
    }, [packRef, onFinished]);

    const handleToggleFavourite = useCallback(async (): Promise<void> => {
        setBusy(true);
        try {
            const refs = getFavoritePackRefs(client);
            const isThisPack = (r: { roomId: string; stateKey: string }): boolean =>
                r.roomId === packRef.room_id && r.stateKey === packRef.state_key;
            const nextRefs = favorited
                ? refs.filter((r) => !isThisPack(r))
                : [...refs, { roomId: packRef.room_id, stateKey: packRef.state_key }];
            await setFavoritePackRefs(client, nextRefs);
            setFavorited(!favorited);
        } finally {
            setBusy(false);
        }
    }, [client, packRef, favorited]);

    const isViewingPack = viewing && room && pack;

    return (
        <BaseDialog
            title={_t("timeline|context_menu|find_pack")}
            className={isViewingPack ? undefined : "mx_FindPackDialog"}
            onFinished={onFinished}
            fixedWidth={false}
        >
            {isViewingPack ? (
                <PackEditor
                    room={room}
                    pack={pack}
                    canManage={canManageImagePacks(room, myUserId)}
                    onBack={() => setViewing(false)}
                />
            ) : !room ? (
                <div className="mx_FindPackDialog_message">
                    <p>{_t("timeline|context_menu|find_pack_not_joined")}</p>
                    <AccessibleButton kind="primary" onClick={handlePreviewRoom}>
                        {_t("timeline|context_menu|find_pack_preview_room")}
                    </AccessibleButton>
                </div>
            ) : !pack ? (
                <div className="mx_FindPackDialog_message">
                    <p>{_t("timeline|context_menu|find_pack_gone")}</p>
                </div>
            ) : (
                <div className="mx_FindPackDialog_row">
                    <PackAvatar mxcUrl={getPackAvatarMxc(pack, client)} room={room} size="40px" />
                    <div className="mx_FindPackDialog_rowInfo">
                        <span className="mx_FindPackDialog_rowName">{packDisplayName(pack.content, pack.stateKey)}</span>
                        <span className="mx_FindPackDialog_rowRoom">{room.name}</span>
                    </div>
                    <AccessibleButton kind="primary_outline" onClick={() => setViewing(true)}>
                        {_t("action|view")}
                    </AccessibleButton>
                    <AccessibleButton kind="primary_outline" onClick={handleToggleFavourite} disabled={busy}>
                        {busy ? (
                            <Spinner />
                        ) : favorited ? (
                            _t("timeline|context_menu|find_pack_unfavourite")
                        ) : (
                            _t("timeline|context_menu|find_pack_favourite")
                        )}
                    </AccessibleButton>
                </div>
            )}
        </BaseDialog>
    );
}

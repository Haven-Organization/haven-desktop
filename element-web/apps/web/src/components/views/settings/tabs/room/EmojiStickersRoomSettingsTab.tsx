/*
 * Haven: MSC2545 (Image Packs) — room settings "Emoji & Stickers" tab.
 *
 * List view: create a new pack, list existing packs (avatar/name/image count), View to open one,
 * X to delete one (deletion = writing an empty pack, since Matrix state can't truly be deleted -
 * see ImagePacks.ts's own doc). "View" opens the shared PackEditor (see
 * settings/emojistickers/PackEditor.tsx) - also used, unchanged, by the user settings tab's own
 * "Emoji & Stickers" pack browser.
 */

import React, { type JSX, useCallback, useState } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";

import { _t } from "../../../../../languageHandler";
import SettingsTab from "../SettingsTab";
import { SettingsSection } from "../../shared/SettingsSection";
import { SettingsSubsection } from "../../shared/SettingsSubsection";
import AccessibleButton from "../../../elements/AccessibleButton";
import Field from "../../../elements/Field";
import Spinner from "../../../elements/Spinner";
import { useRoomState } from "../../../../../hooks/useRoomState";
import {
    getRoomImagePacksForManagement,
    canManageImagePacks,
    getPackAvatarMxc,
    newPackStateKey,
    saveRoomImagePack,
    deleteRoomImagePack,
    packDisplayName,
} from "../../../../../utils/ImagePacks";
import { PackEditor, PackAvatar } from "../../emojistickers/PackEditor";

interface Props {
    room: Room;
}

export default function EmojiStickersRoomSettingsTab({ room }: Props): JSX.Element {
    const client = room.client;
    const myUserId = client.getSafeUserId();

    const packs = useRoomState(
        room,
        useCallback(() => getRoomImagePacksForManagement(room), [room]),
    );
    const canManage = useRoomState(
        room,
        useCallback(() => canManageImagePacks(room, myUserId), [room, myUserId]),
    );

    const [openStateKey, setOpenStateKey] = useState<string | null>(null);
    const [newPackName, setNewPackName] = useState("");
    const [busy, setBusy] = useState(false);

    const handleCreate = useCallback(async (): Promise<void> => {
        const name = newPackName.trim();
        if (!name) return;
        setBusy(true);
        try {
            const stateKey = newPackStateKey(room, name);
            await saveRoomImagePack(client, room.roomId, stateKey, { pack: { display_name: name }, images: {} });
            setNewPackName("");
            setOpenStateKey(stateKey);
        } finally {
            setBusy(false);
        }
    }, [client, room, newPackName]);

    const handleDelete = useCallback(
        async (stateKey: string): Promise<void> => {
            setBusy(true);
            try {
                await deleteRoomImagePack(client, room.roomId, stateKey);
            } finally {
                setBusy(false);
            }
        },
        [client, room],
    );

    const openPack = packs?.find((p) => p.stateKey === openStateKey);
    if (openPack) {
        return (
            <PackEditor
                key={openPack.stateKey}
                room={room}
                pack={openPack}
                canManage={!!canManage}
                onBack={() => setOpenStateKey(null)}
            />
        );
    }

    return (
        <SettingsTab>
            <SettingsSection heading={_t("room_settings|emoji_stickers|title")}>
                {canManage && (
                    <SettingsSubsection heading={_t("room_settings|emoji_stickers|new_pack")}>
                        <div className="mx_EmojiStickersSettingsTab_newPack">
                            <Field
                                label={_t("room_settings|emoji_stickers|pack_name")}
                                value={newPackName}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewPackName(e.currentTarget.value)}
                                disabled={busy}
                                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                                    if (e.key === "Enter") void handleCreate();
                                }}
                            />
                            <AccessibleButton kind="primary" onClick={handleCreate} disabled={busy || !newPackName.trim()}>
                                {_t("action|create")}
                            </AccessibleButton>
                        </div>
                    </SettingsSubsection>
                )}
                <SettingsSubsection heading={_t("room_settings|emoji_stickers|packs")}>
                    {!packs || packs.length === 0 ? (
                        <div className="mx_EmojiStickersSettingsTab_empty">
                            {_t(
                                room.isSpaceRoom()
                                    ? "room_settings|emoji_stickers|no_packs_space"
                                    : "room_settings|emoji_stickers|no_packs",
                            )}
                        </div>
                    ) : (
                        <div className="mx_EmojiStickersSettingsTab_packList">
                            {packs.map((pack) => (
                                <div className="mx_EmojiStickersSettingsTab_packRow" key={pack.stateKey}>
                                    <PackAvatar mxcUrl={getPackAvatarMxc(pack, client)} room={room} />
                                    <div className="mx_EmojiStickersSettingsTab_packInfo">
                                        <span
                                            className="mx_EmojiStickersSettingsTab_packName"
                                            title={packDisplayName(pack.content, pack.stateKey)}
                                        >
                                            {packDisplayName(pack.content, pack.stateKey)}
                                        </span>
                                        <span className="mx_EmojiStickersSettingsTab_packCount">
                                            {_t("room_settings|emoji_stickers|image_count", {
                                                count: Object.keys(pack.content.images).length,
                                            })}
                                        </span>
                                    </div>
                                    <AccessibleButton kind="primary_outline" onClick={() => setOpenStateKey(pack.stateKey)}>
                                        {_t("action|view")}
                                    </AccessibleButton>
                                    {canManage && (
                                        <AccessibleButton
                                            kind="danger_outline"
                                            className="mx_EmojiStickersSettingsTab_removeBtn"
                                            onClick={() => handleDelete(pack.stateKey)}
                                            title={_t("action|remove")}
                                        >
                                            ✕
                                        </AccessibleButton>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                    {busy && <Spinner />}
                </SettingsSubsection>
            </SettingsSection>
        </SettingsTab>
    );
}

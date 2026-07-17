/*
 * Haven: MSC2545 (Image Packs) — user settings "Emoji & Stickers" tab.
 *
 * "Favorite Packs": every pack across every room the user has joined, each with a toggle for
 * whether it's favorited (carried with you into every other room's emoji/sticker picker, not just
 * the room the pack actually lives in). Held in local draft state until Save writes the complete
 * favorited set in one go - matching Cinny/Sable's own layout, restyled for Element's look and
 * feel.
 *
 * Each row also has a "View" button (same as the room settings tab's own pack list) that opens the
 * shared PackEditor (see settings/emojistickers/PackEditor.tsx) for that pack. Since a favorited
 * pack can live in any joined room, not just whichever room the settings dialog happens to be
 * opened from, permission is resolved per-pack against its own source room rather than assumed.
 */

import React, { type JSX, useCallback, useMemo, useState } from "react";

import { _t } from "../../../../../languageHandler";
import SettingsTab from "../SettingsTab";
import { SettingsSection } from "../../shared/SettingsSection";
import { SettingsSubsection } from "../../shared/SettingsSubsection";
import AccessibleButton from "../../../elements/AccessibleButton";
import Spinner from "../../../elements/Spinner";
import { MatrixClientPeg } from "../../../../../MatrixClientPeg";
import {
    type RoomImagePack,
    getAllJoinedRoomPacks,
    getFavoritePackRefs,
    setFavoritePackRefs,
    canManageImagePacks,
    getPackAvatarMxc,
    packDisplayName,
} from "../../../../../utils/ImagePacks";
import { PackEditor } from "../../emojistickers/PackEditor";

function packKey(pack: { roomId: string; stateKey: string }): string {
    return `${pack.roomId} ${pack.stateKey}`;
}

export default function EmojiStickersUserSettingsTab(): JSX.Element {
    const client = MatrixClientPeg.safeGet();
    const myUserId = client.getSafeUserId();

    const packs = useMemo<RoomImagePack[]>(() => getAllJoinedRoomPacks(client), [client]);
    const [favorited, setFavorited] = useState<Set<string>>(() => new Set(getFavoritePackRefs(client).map(packKey)));
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const [openKey, setOpenKey] = useState<string | null>(null);

    const toggle = useCallback((pack: RoomImagePack) => {
        const key = packKey(pack);
        setFavorited((prev) => {
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
        setDirty(true);
    }, []);

    const handleSave = useCallback(async (): Promise<void> => {
        setBusy(true);
        try {
            const refs = packs
                .filter((pack) => favorited.has(packKey(pack)))
                .map(({ roomId, stateKey }) => ({ roomId, stateKey }));
            await setFavoritePackRefs(client, refs);
            setDirty(false);
        } finally {
            setBusy(false);
        }
    }, [client, packs, favorited]);

    const openPack = packs.find((pack) => packKey(pack) === openKey);
    if (openPack) {
        const packRoom = client.getRoom(openPack.roomId);
        if (packRoom) {
            return (
                <PackEditor
                    key={openKey}
                    room={packRoom}
                    pack={openPack}
                    canManage={canManageImagePacks(packRoom, myUserId)}
                    onBack={() => setOpenKey(null)}
                />
            );
        }
    }

    return (
        <SettingsTab>
            <SettingsSection heading={_t("settings|emoji_stickers|title")}>
                <SettingsSubsection
                    heading={_t("settings|emoji_stickers|favorite_packs")}
                    description={_t("settings|emoji_stickers|favorite_packs_description")}
                >
                    {packs.length === 0 ? (
                        <div className="mx_EmojiStickersUserSettingsTab_empty">
                            {_t("settings|emoji_stickers|no_packs")}
                        </div>
                    ) : (
                        <div className="mx_EmojiStickersUserSettingsTab_packList">
                            {packs.map((pack) => {
                                const room = client.getRoom(pack.roomId);
                                // Haven: no width/height/method - see emojipicker/Emoji.tsx's own
                                // identical doc, this must stay a /download/ so an animated (gif)
                                // pack avatar still animates in the favorites list.
                                const avatarMxc = getPackAvatarMxc(pack, client);
                                const httpUrl = avatarMxc ? client.mxcUrlToHttp(avatarMxc) : null;
                                const key = packKey(pack);
                                const isFavorited = favorited.has(key);
                                return (
                                    <div className="mx_EmojiStickersUserSettingsTab_packRow" key={key}>
                                        <label className="mx_EmojiStickersUserSettingsTab_packRowLabel">
                                            <input
                                                type="checkbox"
                                                checked={isFavorited}
                                                onChange={() => toggle(pack)}
                                            />
                                            {httpUrl ? (
                                                <img className="mx_EmojiStickersUserSettingsTab_avatar" src={httpUrl} alt="" />
                                            ) : (
                                                <div className="mx_EmojiStickersUserSettingsTab_avatar mx_EmojiStickersUserSettingsTab_avatar_placeholder" />
                                            )}
                                            <div className="mx_EmojiStickersUserSettingsTab_packInfo">
                                                <span className="mx_EmojiStickersUserSettingsTab_packName">
                                                    {packDisplayName(pack.content, pack.stateKey)}
                                                </span>
                                                <span className="mx_EmojiStickersUserSettingsTab_roomName">
                                                    {room?.name ?? pack.roomId}
                                                </span>
                                            </div>
                                        </label>
                                        <AccessibleButton kind="primary_outline" onClick={() => setOpenKey(key)}>
                                            {_t("action|view")}
                                        </AccessibleButton>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {busy && <Spinner />}
                    <div className="mx_EmojiStickersUserSettingsTab_saveBar">
                        <AccessibleButton kind="primary" onClick={handleSave} disabled={busy || !dirty}>
                            {_t("action|save")}
                        </AccessibleButton>
                    </div>
                </SettingsSubsection>
            </SettingsSection>
        </SettingsTab>
    );
}

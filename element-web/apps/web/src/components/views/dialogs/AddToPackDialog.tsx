/*
 * Haven: MSC2545 (Image Packs) — "Add to Pack" dialog.
 *
 * Opened from MessageContextMenu's own "Add to Pack" option on an image/sticker message (see
 * ImagePacks.ts's own getPackableImageFromEvent for exactly which messages qualify). Lists every
 * pack the user can manage, searchable by pack name or the room it lives in, each with a stylized
 * button that adds the message's image to it in one click - no draft/Save step, unlike the room
 * settings tab's own pack editor, since there's nothing else being edited here.
 */

import React, { type JSX, useCallback, useMemo, useState } from "react";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { AutoHideScrollbar } from "@element-hq/web-shared-components";

import BaseDialog from "./BaseDialog";
import { _t } from "../../../languageHandler";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import AccessibleButton from "../elements/AccessibleButton";
import Field from "../elements/Field";
import Spinner from "../elements/Spinner";
import {
    type RoomImagePack,
    getManageableImagePacks,
    getPackableImageFromEvent,
    getPackAvatarMxc,
    packDisplayName,
    addPackImageFromMxcUrl,
    addImageToExistingPack,
} from "../../../utils/ImagePacks";

interface Props {
    mxEvent: MatrixEvent;
    onFinished: (added?: boolean) => void;
}

function packKey(pack: RoomImagePack): string {
    return `${pack.roomId} ${pack.stateKey}`;
}

function PackRowAvatar({ pack }: { pack: RoomImagePack }): JSX.Element {
    const client = MatrixClientPeg.safeGet();
    // Haven: no width/height/method - see emojipicker/Emoji.tsx's own identical doc, this must
    // stay a /download/ so an animated (gif) pack avatar still animates here too.
    const mxcUrl = getPackAvatarMxc(pack, client);
    const httpUrl = mxcUrl ? client.mxcUrlToHttp(mxcUrl) : null;
    return httpUrl ? (
        <img className="mx_AddToPackDialog_rowAvatar" src={httpUrl} alt="" />
    ) : (
        <div className="mx_AddToPackDialog_rowAvatar mx_AddToPackDialog_rowAvatar_placeholder" />
    );
}

export default function AddToPackDialog({ mxEvent, onFinished }: Props): JSX.Element {
    const client = MatrixClientPeg.safeGet();
    const packs = useMemo(() => getManageableImagePacks(client), [client]);
    const image = useMemo(() => getPackableImageFromEvent(mxEvent), [mxEvent]);

    const [query, setQuery] = useState("");
    const [busyKey, setBusyKey] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const lcQuery = query.trim().toLowerCase();
    const filteredPacks = useMemo(() => {
        if (!lcQuery) return packs;
        return packs.filter((pack) => {
            const room = client.getRoom(pack.roomId);
            const packName = packDisplayName(pack.content, pack.stateKey).toLowerCase();
            const roomName = (room?.name ?? "").toLowerCase();
            return packName.includes(lcQuery) || roomName.includes(lcQuery);
        });
    }, [packs, lcQuery, client]);

    const handleAdd = useCallback(
        async (pack: RoomImagePack): Promise<void> => {
            if (!image) return;
            setBusyKey(packKey(pack));
            setError(null);
            try {
                // Re-fetched and re-decoded (not just reusing the source event's own info/
                // thumbnail verbatim) so this always gets a thumbnail generated under our own
                // rules, regardless of what the original message did or didn't already have.
                const { info } = await addPackImageFromMxcUrl(client, image.mxcUrl);
                await addImageToExistingPack(client, pack.roomId, pack.stateKey, {
                    shortcodeHint: image.body || image.mxcUrl,
                    url: image.mxcUrl,
                    body: image.body,
                    info,
                });
                onFinished(true);
            } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
                setBusyKey(null);
            }
        },
        [client, image, onFinished],
    );

    return (
        <BaseDialog
            title={_t("timeline|context_menu|add_to_pack")}
            className="mx_AddToPackDialog"
            onFinished={() => onFinished(false)}
            fixedWidth={false}
        >
            <Field
                className="mx_AddToPackDialog_search"
                label={_t("timeline|context_menu|add_to_pack_search")}
                value={query}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.currentTarget.value)}
                autoFocus
            />
            {error && <div className="mx_AddToPackDialog_error">{error}</div>}
            <AutoHideScrollbar className="mx_AutoHideScrollbar mx_AddToPackDialog_list">
                {filteredPacks.length === 0 ? (
                    <div className="mx_AddToPackDialog_empty">
                        {_t("timeline|context_menu|add_to_pack_no_packs")}
                    </div>
                ) : (
                    filteredPacks.map((pack) => {
                        const room = client.getRoom(pack.roomId);
                        const key = packKey(pack);
                        return (
                            <div className="mx_AddToPackDialog_row" key={key}>
                                <PackRowAvatar pack={pack} />
                                <div className="mx_AddToPackDialog_rowInfo">
                                    <span className="mx_AddToPackDialog_rowName">
                                        {packDisplayName(pack.content, pack.stateKey)}
                                    </span>
                                    <span className="mx_AddToPackDialog_rowRoom">{room?.name ?? pack.roomId}</span>
                                </div>
                                <AccessibleButton
                                    kind="primary_outline"
                                    onClick={() => handleAdd(pack)}
                                    disabled={busyKey !== null || !image}
                                >
                                    {busyKey === key ? <Spinner /> : _t("action|add")}
                                </AccessibleButton>
                            </div>
                        );
                    })
                )}
            </AutoHideScrollbar>
        </BaseDialog>
    );
}

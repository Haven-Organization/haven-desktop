/*
 * Haven: MSC2545 (Image Packs) - the "..." menu on a pack's row in the room/space settings pack
 * list and the user settings Favorite Packs list. Holds the actions that used to be their own
 * buttons next to View (Copy, and Delete for a pack the user can manage), and asks before deleting.
 */

import React, { type JSX, useCallback, useState } from "react";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import { IconButton, Menu, MenuItem } from "@vector-im/compound-web";
import { CopyIcon, DeleteIcon, OverflowHorizontalIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import { _t } from "../../../../languageHandler";
import Modal from "../../../../Modal";
import QuestionDialog from "../../dialogs/QuestionDialog";
import CopyPackDialog from "../../dialogs/CopyPackDialog";
import { type RoomImagePack, deleteRoomImagePack, packDisplayName } from "../../../../utils/ImagePacks";

interface Props {
    matrixClient: MatrixClient;
    pack: RoomImagePack;
    /** Whether the user may delete this pack. Without it the menu only offers Copy. */
    canManage: boolean;
    /** Passed on to the copy dialog, which closes settings when it navigates away. */
    closeSettingsFn?: () => void;
    /** Called while the pack is being deleted, for the list's own busy state. */
    onBusyChange?: (busy: boolean) => void;
    /** Called once the pack has been deleted. */
    onDeleted?: () => void;
}

/**
 * Asks whether to delete `pack`, and deletes it if confirmed.
 * @returns whether the pack was deleted.
 */
export async function confirmAndDeletePack(client: MatrixClient, pack: RoomImagePack): Promise<boolean> {
    const { finished } = Modal.createDialog(QuestionDialog, {
        title: _t("room_settings|emoji_stickers|delete_pack_title"),
        description: _t("room_settings|emoji_stickers|delete_pack_description", {
            name: packDisplayName(pack.content, pack.stateKey),
        }),
        button: _t("action|delete"),
        danger: true,
    });
    const [confirmed] = await finished;
    if (!confirmed) return false;
    await deleteRoomImagePack(client, pack.roomId, pack.stateKey);
    return true;
}

export function PackRowMenu({
    matrixClient,
    pack,
    canManage,
    closeSettingsFn,
    onBusyChange,
    onDeleted,
}: Props): JSX.Element {
    const [open, setOpen] = useState(false);

    const handleCopy = useCallback((): void => {
        Modal.createDialog(CopyPackDialog, { matrixClient, pack, closeSettingsFn }, "mx_CopyPackDialog_wrapper");
    }, [matrixClient, pack, closeSettingsFn]);

    const handleDelete = useCallback(async (): Promise<void> => {
        onBusyChange?.(true);
        try {
            if (await confirmAndDeletePack(matrixClient, pack)) onDeleted?.();
        } finally {
            onBusyChange?.(false);
        }
    }, [matrixClient, pack, onBusyChange, onDeleted]);

    return (
        <Menu
            open={open}
            onOpenChange={setOpen}
            title={_t("room_settings|emoji_stickers|pack_options")}
            showTitle={false}
            align="end"
            trigger={
                <IconButton size="32px" aria-label={_t("room_settings|emoji_stickers|pack_options")}>
                    <OverflowHorizontalIcon />
                </IconButton>
            }
        >
            <MenuItem Icon={CopyIcon} label={_t("action|copy")} onSelect={handleCopy} />
            {canManage && (
                <MenuItem Icon={DeleteIcon} kind="critical" label={_t("action|delete")} onSelect={handleDelete} />
            )}
        </Menu>
    );
}

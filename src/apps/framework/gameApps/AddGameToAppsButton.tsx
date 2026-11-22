/*
 * Haven apps framework - the "Add to Apps" button on a game's card, which adds the game to the
 * user's apps (gameApps.ts), or removes it again.
 */

import React, { type JSX, useState } from "react";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";
import { Button, Tooltip } from "@vector-im/compound-web";
import { GridIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import { useMatrixClientContext } from "../../../../element-web/apps/web/src/contexts/MatrixClientContext";
import Modal from "../../../../element-web/apps/web/src/Modal";
import ErrorDialog from "../../../../element-web/apps/web/src/components/views/dialogs/ErrorDialog";
import { gameAppsEnabled } from "../registry";
import { addGameApp, removeGameApp, useGameAppEntries } from "./gameApps";

interface Props {
    mxEvent: MatrixEvent;
    gameId: string;
    flash: boolean;
    /** The game's name and a small copy of its icon (see WebxdcGame). */
    describe: () => Promise<{ name: string; icon?: string }>;
}

export function AddGameToAppsButton({ mxEvent, gameId, flash, describe }: Props): JSX.Element | null {
    const client = useMatrixClientContext();
    const entries = useGameAppEntries(client);
    const [busy, setBusy] = useState(false);
    const roomId = mxEvent.getRoomId();
    const eventId = mxEvent.getId();
    // Not for a message that hasn't been sent yet: it has no id to link to.
    if (!gameAppsEnabled() || !roomId || !eventId?.startsWith("$")) return null;

    const added = entries.some((e) => e.room_id === roomId && e.event_id === eventId);
    const label = added ? "Remove from Apps" : "Add to Apps";

    const onClick = async (): Promise<void> => {
        setBusy(true);
        try {
            if (added) {
                await removeGameApp(client, roomId, eventId);
            } else {
                const { name, icon } = await describe();
                await addGameApp(client, {
                    room_id: roomId,
                    event_id: eventId,
                    game_id: gameId,
                    name,
                    icon,
                    flash: flash || undefined,
                    room_name: client.getRoom(roomId)?.name,
                });
            }
        } catch (e) {
            logger.error("Couldn't change a game app", e);
            Modal.createDialog(ErrorDialog, {
                title: added ? "Couldn't remove the game from Apps" : "Couldn't add the game to Apps",
                description: "Check your connection and try again.",
            });
        } finally {
            setBusy(false);
        }
    };

    return (
        <Tooltip label={label} caption={added ? undefined : "Keep this game in your apps, next to your spaces"}>
            <Button
                kind={added ? "primary" : "secondary"}
                size="md"
                Icon={GridIcon}
                iconOnly
                aria-label={label}
                aria-pressed={added}
                disabled={busy}
                onClick={onClick}
            />
        </Tooltip>
    );
}

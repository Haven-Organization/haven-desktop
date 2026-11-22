/*
 * Haven apps framework - "Add to Apps" button for a room widget
 *
 * Shown in a widget's title bar (AppTile.tsx) and on its row in the room's Extensions list
 * (ExtensionsCard.tsx). Everyone can use it, not only people allowed to change the room's widgets,
 * which is why it isn't in the widget's options menu: Element only shows that menu to them.
 */

import React, { type JSX, useState } from "react";
import { GridIcon } from "@vector-im/compound-design-tokens/assets/web/icons";
import { type Room } from "matrix-js-sdk/src/matrix";
import { type IWidget } from "matrix-widget-api";
import { logger } from "matrix-js-sdk/src/logger";

import AccessibleButton from "../../../../element-web/apps/web/src/components/views/elements/AccessibleButton";
import Modal from "../../../../element-web/apps/web/src/Modal";
import ErrorDialog from "../../../../element-web/apps/web/src/components/views/dialogs/ErrorDialog";
import { useMatrixClientContext } from "../../../../element-web/apps/web/src/contexts/MatrixClientContext";
import { isAppWidget } from "../../../../element-web/apps/web/src/stores/WidgetStore";
import { widgetAppsEnabled } from "../registry";
import { addWidgetApp, isWidgetPresent, removeWidgetApp, useWidgetAppEntries } from "./widgetApps";

interface Props {
    app: IWidget;
    room?: Room;
    className: string;
    iconClassName?: string;
}

export function AddToAppsButton({ app, room, className, iconClassName }: Props): JSX.Element | null {
    const client = useMatrixClientContext();
    const entries = useWidgetAppEntries(client);
    const [busy, setBusy] = useState(false);

    // Only a widget the room itself has: not an account widget, nor a virtual one like a call.
    if (!widgetAppsEnabled() || !room || !isAppWidget(app) || app.eventId === undefined) return null;
    if (!isWidgetPresent(room, app.id)) return null;

    const added = entries.some((e) => e.room_id === room.roomId && e.widget_id === app.id);
    const label = added ? "Remove from Apps" : "Add to Apps";

    const onClick = async (): Promise<void> => {
        setBusy(true);
        try {
            if (added) await removeWidgetApp(client, room.roomId, app.id);
            else await addWidgetApp(client, room, app.id);
        } catch (e) {
            logger.error("Couldn't change the widget's place in Apps", e);
            Modal.createDialog(ErrorDialog, {
                title: added ? "Couldn't remove the widget from Apps" : "Couldn't add the widget to Apps",
                description: "Check your connection and try again.",
            });
        } finally {
            setBusy(false);
        }
    };

    return (
        <AccessibleButton
            className={`${className} haven_AddToAppsButton${added ? " haven_AddToAppsButton--added" : ""}`}
            title={label}
            aria-pressed={added}
            disabled={busy}
            onClick={onClick}
        >
            <GridIcon className={iconClassName} />
        </AccessibleButton>
    );
}

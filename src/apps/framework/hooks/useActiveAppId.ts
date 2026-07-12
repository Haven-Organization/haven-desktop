import { useState } from "react";

import defaultDispatcher from "../../../../element-web/apps/web/src/dispatcher/dispatcher";
import { Action } from "../../../../element-web/apps/web/src/dispatcher/actions";
import { useDispatcher } from "../../../../element-web/apps/web/src/hooks/useDispatcher";
import { getAppByHomeAction } from "../registry";

/** Id of whichever Haven app is currently open full-width, or null if none is. */
export function useActiveAppId(): string | null {
    const [activeAppId, setActiveAppId] = useState<string | null>(null);

    useDispatcher(defaultDispatcher, (payload) => {
        const app = getAppByHomeAction(payload.action);
        if (app) {
            setActiveAppId(app.id);
        } else if (
            payload.action === Action.ViewRoom ||
            payload.action === Action.ViewHomePage ||
            payload.action === "view_welcome_page"
        ) {
            setActiveAppId(null);
        }
    });

    return activeAppId;
}

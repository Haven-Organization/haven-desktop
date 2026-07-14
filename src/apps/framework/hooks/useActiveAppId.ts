import { useEffect, useState } from "react";

import defaultDispatcher from "../../../../element-web/apps/web/src/dispatcher/dispatcher";
import { Action } from "../../../../element-web/apps/web/src/dispatcher/actions";
import { useDispatcher } from "../../../../element-web/apps/web/src/hooks/useDispatcher";
import { getAppByHomeAction } from "../registry";
import { clearPendingActiveAppId, peekPendingActiveAppId } from "../pendingActiveApp";

/** Id of whichever Haven app is currently open full-width, or null if none is. */
export function useActiveAppId(): string | null {
    // Lazy initializer, not a mount effect - see pendingActiveApp.ts's own comment for why this
    // specifically is what makes a cold-start deep link into an app (e.g. #/social) correctly
    // deselect Home from the very first render, instead of only catching up on the *next* app
    // switch.
    const [activeAppId, setActiveAppId] = useState<string | null>(() => peekPendingActiveAppId());

    useEffect(() => {
        clearPendingActiveAppId();
    }, []);

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

/*
Copyright 2024 New Vector Ltd.
Copyright 2020, 2021 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// Haven: devtools-console window globals for the old room list's own stores - upstream removed
// these from src/@types/global.d.ts along with the stores themselves. Kept isolated here rather
// than re-added to that file - see index.ts's own doc.

import type RoomListStore from "./stores/RoomListStore";
import type RoomListLayoutStore from "./stores/RoomListLayoutStore";

declare global {
    interface Window {
        mxRoomListStore: RoomListStore;
        mxRoomListLayoutStore: RoomListLayoutStore;
    }
}

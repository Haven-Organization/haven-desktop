/*
 * Copyright 2024 New Vector Ltd.
 * Copyright 2020 The Matrix.org Foundation C.I.C.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { type Widget } from "matrix-widget-api";
import { type EmptyObject } from "matrix-js-sdk/src/matrix";

import { AsyncStoreWithClient } from "../AsyncStoreWithClient";
import defaultDispatcher from "../../dispatcher/dispatcher";
import { type ActionPayload } from "../../dispatcher/payloads";
import { EnhancedMap } from "../../utils/maps";
import WidgetUtils from "../../utils/WidgetUtils";
import { type WidgetMessaging } from "./WidgetMessaging";

export enum WidgetMessagingStoreEvent {
    StoreMessaging = "store_messaging",
    StopMessaging = "stop_messaging",
}

/**
 * Temporary holding store for widget messaging instances. This is eventually
 * going to be merged with a more complete WidgetStore, but for now it's
 * easiest to split this into a single place.
 */
export class WidgetMessagingStore extends AsyncStoreWithClient<EmptyObject> {
    // Deliberately NOT an eagerly-invoked static field initializer (`= (() => {...})()`) — see
    // WidgetStore.ts's own instance getter for the full explanation. In short: that ran .start()
    // (which reads MatrixClientPeg) the instant this module was evaluated rather than on first real
    // use, which could fire while MatrixClientPeg.ts was still mid-evaluation in this pre-existing
    // circular import chain, throwing "Cannot access 'MatrixClientPeg' before initialization".
    private static internalInstance: WidgetMessagingStore;

    private widgetMap = new EnhancedMap<string, WidgetMessaging>(); // <widget UID, messaging>

    public constructor() {
        super(defaultDispatcher);
    }

    public static get instance(): WidgetMessagingStore {
        if (!WidgetMessagingStore.internalInstance) {
            WidgetMessagingStore.internalInstance = new WidgetMessagingStore();
            WidgetMessagingStore.internalInstance.start();
        }
        return WidgetMessagingStore.internalInstance;
    }

    protected async onAction(payload: ActionPayload): Promise<void> {
        // nothing to do
    }

    protected async onReady(): Promise<any> {
        // just in case
        this.widgetMap.clear();
    }

    public storeMessaging(widget: Widget, roomId: string | undefined, messaging: WidgetMessaging): void {
        this.stopMessaging(widget, roomId);
        const uid = WidgetUtils.calcWidgetUid(widget.id, roomId);
        this.widgetMap.set(uid, messaging);

        this.emit(WidgetMessagingStoreEvent.StoreMessaging, uid, messaging);
    }

    public stopMessaging(widget: Widget, roomId: string | undefined): void {
        this.stopMessagingByUid(WidgetUtils.calcWidgetUid(widget.id, roomId));
    }

    public getMessaging(widget: Widget, roomId: string | undefined): WidgetMessaging | undefined {
        return this.widgetMap.get(WidgetUtils.calcWidgetUid(widget.id, roomId));
    }

    /**
     * Stops the widget messaging instance for a given widget UID.
     * @param {string} widgetUid The widget UID.
     */
    public stopMessagingByUid(widgetUid: string): void {
        const messaging = this.widgetMap.remove(widgetUid);
        if (messaging !== undefined) {
            messaging.stop();
            this.emit(WidgetMessagingStoreEvent.StopMessaging, widgetUid);
        }
    }

    /**
     * Gets the widget messaging class for a given widget UID.
     * @param {string} widgetUid The widget UID.
     * @returns {ClientWidgetApi} The widget API, or a falsy value if not found.
     */
    public getMessagingForUid(widgetUid: string): WidgetMessaging | undefined {
        return this.widgetMap.get(widgetUid);
    }
}

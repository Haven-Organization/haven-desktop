/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { type Room } from "matrix-js-sdk/src/matrix";

import { type Filter, FilterEnum } from ".";

export class ExcludeTagsFilter implements Filter {
    // Takes the actual per-section Filter instances (not raw tag strings) so a section whose
    // membership isn't a literal room.tags entry - e.g. the DM/People section, matched via
    // PeopleFilter against DMRoomMap rather than room.tags[DefaultTagID.DM] - is still excluded
    // from the Chats catch-all correctly.
    public constructor(private readonly filters: Filter[]) {}

    public matches(room: Room): boolean {
        return !this.filters.some((filter) => filter.matches(room));
    }

    public get key(): FilterEnum.ExcludeTagsFilter {
        return FilterEnum.ExcludeTagsFilter;
    }
}

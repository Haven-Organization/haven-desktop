/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { type Room } from "matrix-js-sdk/src/matrix";

import { type Filter } from ".";
import { PeopleFilter } from "./PeopleFilter";
import { DefaultTagID } from "../tag";

/**
 * Matches DM rooms for the People/DM section - but only when the room has no other, higher-
 * priority section tag of its own (Favourite, LowPriority, or a custom section). An explicitly
 * tagged DM belongs in that tag's own section instead, mirroring getTagsOfJoinedRoom's own
 * "only synthesize the DM tag if nothing else applies" precedence.
 */
export class PeopleSectionFilter implements Filter {
    private readonly peopleFilter = new PeopleFilter();

    public constructor(private readonly otherSectionFilters: Filter[]) {}

    public matches(room: Room): boolean {
        return this.peopleFilter.matches(room) && !this.otherSectionFilters.some((filter) => filter.matches(room));
    }

    public get key(): string {
        return DefaultTagID.DM;
    }
}

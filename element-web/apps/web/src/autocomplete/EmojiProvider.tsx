/*
Copyright 2024 New Vector Ltd.
Copyright 2022 Ryan Browne <code@commonlawfeature.com>
Copyright 2019 The Matrix.org Foundation C.I.C.
Copyright 2017, 2018 New Vector Ltd
Copyright 2017 Vector Creations Ltd
Copyright 2016 Aviral Dasgupta

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import { uniq, sortBy, uniqBy, type ListIteratee } from "lodash";
import EMOTICON_REGEX from "emojibase-regex/emoticon";
import { type Room } from "matrix-js-sdk/src/matrix";
import { EMOJI, type Emoji, getEmojiFromUnicode } from "@matrix-org/emojibase-bindings";

import { _t } from "../languageHandler";
import AutocompleteProvider from "./AutocompleteProvider";
import QueryMatcher from "./QueryMatcher";
import { PillCompletion } from "./Components";
import { type ICompletion, type ISelectionRange } from "./Autocompleter";
import SettingsStore from "../settings/SettingsStore";
import { type TimelineRenderingType } from "../contexts/RoomContext";
import * as recent from "../emojipicker/recent";
import { filterBoolean } from "../utils/arrays";
import { getEmoticonPacks, imagesForUsage, packDisplayName } from "../utils/ImagePacks";
import { makeCustomEmoji, isCustomEmoji, type CustomEmojiLike } from "../components/views/emojipicker/customEmoji";

const LIMIT = 20;

// Match for ascii-style ";-)" emoticons or ":wink:" shortcodes provided by emojibase
// anchored to only match from the start of parts otherwise it'll show emoji suggestions whilst typing matrix IDs
const EMOJI_REGEX = new RegExp("(" + EMOTICON_REGEX.source + "|(?:^|\\s):[+-\\w]*:?)$", "g");

interface ISortedEmoji {
    emoji: Emoji;
    _orderBy: number;
}

const SORTED_EMOJI: ISortedEmoji[] = EMOJI.sort((a, b) => {
    if (a.group === b.group) {
        return a.order! - b.order!;
    }
    return a.group! - b.group!;
}).map((emoji, index) => ({
    emoji,
    // Include the index so that we can preserve the original order
    _orderBy: index,
}));

function score(query: string, space: string[] | string): number {
    if (Array.isArray(space)) {
        return Math.min(...space.map((s) => score(query, s)));
    }

    const index = space.indexOf(query);
    if (index === -1) {
        return Infinity;
    } else {
        return index;
    }
}

function colonsTrimmed(str: string): string {
    // Trim off leading and potentially trailing `:` to correctly match the emoji data as they exist in emojibase.
    // Notes: The regex is pinned to the start and end of the string so that we can use the lazy-capturing `*?` matcher.
    // It needs to be lazy so that the trailing `:` is not captured in the replacement group, if it exists.
    return str.replace(/^:(.*?):?$/, "$1");
}

/** Haven: this room's + the user's favorited pack emoji (usage: emoticon), wrapped in the same
 *  ISortedEmoji shape as stock emojibase data - see customEmoji.ts's own doc for why makeCustomEmoji
 *  produces an Emoji-shaped stand-in in the first place. Mixed straight into SORTED_EMOJI below so
 *  a custom emoji ranks, sorts, and dedupes alongside real ones in the exact same completion list,
 *  under the single "Emoji" heading, rather than getting its own separate autocomplete section. */
function buildCustomEmojiPool(room: Room): ISortedEmoji[] {
    const packs = getEmoticonPacks(room, "emoticon");
    const pool: ISortedEmoji[] = [];
    let orderBy = SORTED_EMOJI.length;
    for (const pack of packs) {
        const name = packDisplayName(pack.content, pack.stateKey);
        for (const { shortcode, image } of imagesForUsage(pack, "emoticon")) {
            pool.push({
                emoji: makeCustomEmoji(shortcode, image.url, name, pack.roomId, pack.stateKey, image.info),
                _orderBy: orderBy++,
            });
        }
    }
    return pool;
}

export default class EmojiProvider extends AutocompleteProvider {
    public matcher: QueryMatcher<ISortedEmoji>;
    public nameMatcher: QueryMatcher<ISortedEmoji>;
    private readonly recentlyUsed: Emoji[];
    private readonly room: Room;

    public constructor(room: Room, renderingType?: TimelineRenderingType) {
        super({ commandRegex: EMOJI_REGEX, renderingType });
        this.room = room;
        const allEmoji: ISortedEmoji[] = SORTED_EMOJI.concat(buildCustomEmojiPool(room));
        this.matcher = new QueryMatcher<ISortedEmoji>(allEmoji, {
            keys: [],
            funcs: [(o) => o.emoji.shortcodes.map((s) => `:${s}:`)],
            // For matching against ascii equivalents
            shouldMatchWordsOnly: false,
        });
        this.nameMatcher = new QueryMatcher(allEmoji, {
            keys: ["emoji.label"],
            // For removing punctuation
            shouldMatchWordsOnly: true,
        });

        this.recentlyUsed = Array.from(new Set(filterBoolean(recent.get().map(getEmojiFromUnicode))));
    }

    public async getCompletions(
        query: string,
        selection: ISelectionRange,
        force?: boolean,
        limit = -1,
    ): Promise<ICompletion[]> {
        if (!SettingsStore.getValue("MessageComposerInput.suggestEmoji")) {
            return []; // don't give any suggestions if the user doesn't want them
        }

        let completions: ISortedEmoji[] = [];
        const { command, range } = this.getCurrentCommand(query, selection);

        if (command && command[0].length > 2) {
            const matchedString = command[0];
            completions = this.matcher.match(matchedString, limit);

            // Do second match with shouldMatchWordsOnly in order to match against 'name'
            completions = completions.concat(this.nameMatcher.match(matchedString));

            const sorters: ListIteratee<ISortedEmoji>[] = [];
            // make sure that emoticons come first
            sorters.push((c) => score(matchedString, c.emoji.emoticon || ""));

            // then sort by score (Infinity if matchedString not in shortcode)
            sorters.push((c) => score(matchedString, c.emoji.shortcodes[0]));
            // then sort by max score of all shortcodes, trim off the `:`
            const trimmedMatch = colonsTrimmed(matchedString);
            sorters.push((c) => Math.min(...c.emoji.shortcodes.map((s) => score(trimmedMatch, s))));
            // If the matchedString is not empty, sort by length of shortcode. Example:
            //  matchedString = ":bookmark"
            //  completions = [":bookmark:", ":bookmark_tabs:", ...]
            if (matchedString.length > 1) {
                sorters.push((c) => c.emoji.shortcodes[0].length);
            }
            // Finally, sort by original ordering
            sorters.push((c) => c._orderBy);
            completions = sortBy<ISortedEmoji>(uniq(completions), sorters);

            completions = completions.slice(0, LIMIT);

            // Do a second sort to place emoji matching with frequently used one on top
            const recentlyUsedAutocomplete: ISortedEmoji[] = [];
            this.recentlyUsed.forEach((emoji) => {
                if (emoji.shortcodes[0].indexOf(trimmedMatch) === 0) {
                    recentlyUsedAutocomplete.push({ emoji: emoji, _orderBy: 0 });
                }
            });

            //if there is an exact shortcode match in the frequently used emojis, it goes before everything
            for (let i = 0; i < recentlyUsedAutocomplete.length; i++) {
                if (recentlyUsedAutocomplete[i].emoji.shortcodes[0] === trimmedMatch) {
                    const exactMatchEmoji = recentlyUsedAutocomplete[i];
                    for (let j = i; j > 0; j--) {
                        recentlyUsedAutocomplete[j] = recentlyUsedAutocomplete[j - 1];
                    }
                    recentlyUsedAutocomplete[0] = exactMatchEmoji;
                    break;
                }
            }

            completions = recentlyUsedAutocomplete.concat(completions);
            completions = uniqBy(completions, "emoji");

            return completions.map((c) => {
                if (isCustomEmoji(c.emoji)) {
                    const custom: CustomEmojiLike = c.emoji;
                    const shortcode = `:${custom.shortcodes[0]}:`;
                    return {
                        completion: shortcode,
                        type: "custom-emoji",
                        mxcUrl: custom.mxcUrl,
                        packName: custom.packName,
                        roomId: custom.roomId,
                        stateKey: custom.stateKey,
                        component: (
                            <PillCompletion title={shortcode} aria-label={custom.shortcodes[0]}>
                                <img
                                    className="mx_EmojiProvider_customEmojiImage"
                                    src={this.room.client.mxcUrlToHttp(custom.mxcUrl) ?? custom.mxcUrl}
                                    alt=""
                                />
                            </PillCompletion>
                        ),
                        range: range!,
                    };
                }
                return {
                    completion: c.emoji.unicode,
                    component: (
                        <PillCompletion title={`:${c.emoji.shortcodes[0]}:`} aria-label={c.emoji.unicode}>
                            <span>{c.emoji.unicode}</span>
                        </PillCompletion>
                    ),
                    range: range!,
                };
            });
        }
        return [];
    }

    public getName(): string {
        return "😃 " + _t("common|emoji");
    }

    public renderCompletions(completions: React.ReactNode[]): React.ReactNode {
        return (
            <div
                className="mx_Autocomplete_Completion_container_pill"
                aria-label={_t("composer|autocomplete|emoji_a11y")}
            >
                {completions}
            </div>
        );
    }
}

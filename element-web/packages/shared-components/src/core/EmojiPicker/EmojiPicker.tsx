/*
 * Copyright 2026 Element Creations Ltd.
 * Copyright 2020 The Matrix.org Foundation C.I.C.
 * Copyright 2019 Tulir Asokan <tulir@maunium.net>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type Dispatch, useCallback, useId, useMemo, useRef, useState } from "react";
import { DATA_BY_CATEGORY, getEmojiFromUnicode, type Emoji as IEmoji } from "@matrix-org/emojibase-bindings";
import { type ListRange, Virtuoso, type Components, type VirtuosoHandle } from "react-virtuoso";
import { Heading } from "@vector-im/compound-web";
import classNames from "classnames";

import { _t, _td } from "../i18n/i18n";
import { AutoHideScrollbar } from "../utils/Scrollbar";
import {
    type IAction as RovingAction,
    type IState as RovingState,
    RovingGridIndexProvider,
    RovingStateActionType,
    type RovingTabIndexProviderProps,
} from "../roving";
import { Tabs } from "./Tabs";
import { Search } from "./Search";
import { Preview } from "./Preview";
import { QuickReactions } from "./QuickReactions";
import { Emoji, type PickerEmoji } from "./Emoji";
import { type ButtonEvent } from "./RovingButton";
import styles from "./EmojiPicker.module.css";

const ZERO_WIDTH_JOINER = "\u200D";

export const EMOJI_HEIGHT = 35;
export const EMOJIS_PER_ROW = 8;

/** Haven: the Stickers tab's own grid slot - bigger than a regular emoji's, at a 4-per-row layout
 *  (304px / 4 = 76px; this and .row's own fixed 304px width in EmojiPicker.module.css must change
 *  together - EMOJIS_PER_ROW's 8-per-row and STICKERS_PER_ROW's 4-per-row both divide it evenly). */
export const STICKER_HEIGHT = 70;
export const STICKERS_PER_ROW = 4;

const CATEGORY_CONFIG: Category[] = [
    { id: "recent", untranslatedName: _td("emoji|category_frequently_used"), emoji: "🕒" },
    { id: "people", untranslatedName: _td("emoji|category_smileys_people"), emoji: "😀" },
    { id: "nature", untranslatedName: _td("emoji|category_animals_nature"), emoji: "🐕" },
    { id: "foods", untranslatedName: _td("emoji|category_food_drink"), emoji: "🍎" },
    { id: "activity", untranslatedName: _td("emoji|category_activities"), emoji: "⚽️" },
    { id: "places", untranslatedName: _td("emoji|category_travel_places"), emoji: "🚗" },
    { id: "objects", untranslatedName: _td("emoji|category_objects"), emoji: "💡" },
    { id: "symbols", untranslatedName: _td("emoji|category_symbols"), emoji: "⁉️" },
    { id: "flags", untranslatedName: _td("emoji|category_flags"), emoji: "🏁" },
];

// Haven: widened from `keyof typeof DATA_BY_CATEGORY | "recent"` to a plain string - a pack's own
// synthetic category id (e.g. `pack:!roomId:stateKey`) isn't one of emojibase's own fixed category
// keys, and there's no fixed enumeration of how many packs might exist.
export type CategoryKey = string;

export interface Category {
    id: CategoryKey;
    /** Ignored (see `name`) when `name` is set - a category with a runtime name (a pack's own
     *  display name, which isn't one of this app's own translated strings) has no TranslationKey
     *  to give here at all. */
    untranslatedName?: TranslationKey;
    /** Haven: a plain, already-resolved display name - takes priority over `untranslatedName` when
     *  present. Used for pack categories, whose name comes from room state at runtime rather than
     *  from this app's own i18n catalogue. */
    name?: string;
    // Emoji to show in the header for this category - ignored (rail shows iconUrl instead) when
    // iconUrl is set.
    emoji: string;
    /** Haven: shown in the rail instead of `emoji` when present - e.g. an MSC2545 pack's own mxc
     *  avatar, already resolved to an http(s) URL by the caller. */
    iconUrl?: string;
    /** Haven: renders via renderEmptyStateCategory instead of a grid of Emoji cells - e.g. "this
     *  room has no packs yet, create one". */
    isEmptyState?: boolean;
}

/** Haven: a category's own display name - `name` (a pack's runtime name) takes priority over
 *  `untranslatedName` (this app's own i18n catalogue) when both are absent that's a bug in the
 *  caller, not something to silently paper over, so this intentionally isn't defensive about it. */
export function categoryName(category: Category): string {
    return category.name ?? _t(category.untranslatedName!);
}

/**
 * A single entry in the flat virtual list: either a category header or a row of
 * emoji. Headers are interleaved with the rows so that they scroll inline with
 * the content rather than staying pinned to the top.
 */
type ListItem =
    | { type: "header"; category: Category }
    | { type: "row"; emojis: PickerEmoji[]; categoryId: CategoryKey }
    | { type: "empty-state"; category: Category };

// Stable component identities so Virtuoso does not remount its internals on re-render.
// The single Virtuoso renders a flat list that mixes category headers and emoji rows.
// The Item wrapper picks its semantics per entry: a plain block for headers, a grid
// row for emoji rows.
const GridList: Components<ListItem>["List"] = ({ ref, ...props }) => {
    return <div {...props} ref={ref} className={styles.list} role="grid" aria-multiselectable />;
};

const GridItem: Components<ListItem>["Item"] = ({ item, ...props }) => {
    // Headers (and Haven's empty-state category bodies) are interleaved with emoji rows as direct
    // children of the role="grid" list, so they must also be grid rows: a grid may only own
    // rows/rowgroups.
    if (item.type === "header" || item.type === "empty-state") {
        return <div {...props} role="row" />;
    }
    return <div {...props} role="row" className={styles.row} />;
};

const gridComponents = { List: GridList, Item: GridItem };

/**
 * Props for {@link EmojiPicker}.
 */
export interface EmojiPickerProps {
    /**
     * Set of which emojis are already selected and should be decorated as such.
     * If specified, emoji will use a checkbox role with aria-checked set appropriately.
     */
    selectedEmojis?: Set<string>;
    /**
     * Called when the user chooses an emoji.
     *
     * Haven: `emoji` is the full picked item, present whenever the choice came from a category
     * (extraCategories or the stock ones) rather than the freeform-reaction path some callers add
     * around this component - lets a caller that cares about non-unicode picks (e.g. one that
     * passed extraCategories of its own) recover whatever extra data it originally attached to that
     * item (an image URL, a source room, etc.), while callers that only ever deal in plain unicode
     * emoji can ignore the second argument entirely.
     *
     * Return `false` to prevent the emoji being recorded as recently used.
     */
    onChoose: (unicode: string, emoji?: PickerEmoji) => boolean;
    /**
     * Called when the picker is done, e.g. an emoji was chosen with Enter.
     */
    onFinished: () => void;
    /**
     * Returns whether the emoji with the given unicode should be disabled.
     */
    isEmojiDisabled?: (unicode: string) => boolean;
    /**
     * Recently used emoji (unicode strings, most relevant first) to show in the
     * "Frequently Used" category. The category is hidden when empty or omitted.
     */
    recentEmojis?: string[];
    /**
     * Called with the chosen emoji unicode when it should be recorded as
     * recently used, i.e. when {@link onChoose} did not return `false`.
     */
    onRecordRecent?: (unicode: string) => void;
    /**
     * Optional action resolver used to map keyboard events to roving actions,
     * e.g. to apply app-level custom keybindings.
     *
     * When omitted, a default mapping based on `KeyboardEvent.key` is used.
     */
    getAction?: RovingTabIndexProviderProps["getAction"];
    /**
     * Haven: when given, renders a trailing settings button below the category rail - see Tabs.tsx's
     * own doc for why this was reintroduced.
     */
    onOpenSettings?: () => void;
    /**
     * Whether to show the quick reactions at the bottom of the picker. Defaults to true.
     * Previews of emoji are displayed in the same bar as will also be hidden when this is false.
     */
    showQuickReactions?: boolean;
    /**
     * Haven: extra categories to splice in after "Frequently Used" and before the stock unicode
     * categories (e.g. MSC2545 image packs) - each entry's `items` are shown exactly like a stock
     * category's emoji, so a PickerEmoji with `imageUrl` set renders as an image rather than a
     * unicode glyph (see Emoji.tsx). Ignored entirely in "sticker" mode, which uses
     * stickerCategories instead.
     */
    extraCategories?: Category[];
    /**
     * Haven: emoji/image data for each entry in extraCategories, keyed by that category's own id.
     */
    dataByExtraCategory?: Record<string, PickerEmoji[]>;
    /**
     * Haven: "emoji" (default) shows the normal unicode categories (plus extraCategories, if any).
     * "sticker" replaces the whole picker with stickerCategories only - the stock unicode
     * categories, "Frequently Used", and quick reactions are all meaningless for stickers (which
     * can never be sent as a plain unicode m.reaction) and are hidden entirely in this mode.
     */
    mode?: "emoji" | "sticker";
    /**
     * Haven: categories to show in "sticker" mode, in place of extraCategories/the stock unicode
     * ones. Ignored in "emoji" mode.
     */
    stickerCategories?: Category[];
    /**
     * Haven: emoji/image data for each entry in stickerCategories, keyed by that category's own id.
     */
    dataByStickerCategory?: Record<string, PickerEmoji[]>;
    /**
     * Haven: called with the current search filter text on every change - lets a caller build its
     * own UI around the current query (e.g. ReactionPicker's "React with '<text>'" freeform
     * option, rendered via belowSearch below) without this component needing to know that feature
     * exists.
     */
    onFilterChange?: (filter: string) => void;
    /**
     * Haven: rendered inside the main (non-rail) column, directly below the search box and above
     * the results grid - e.g. ReactionPicker's own "React with '<text>'" freeform option (see
     * onFilterChange above). A caller can't correctly position this itself from outside: it needs
     * to line up with the search box/grid, not span the rail's own width too.
     */
    belowSearch?: React.ReactNode;
    /**
     * Haven: rendered in place of a category's own emoji grid when that category's `isEmptyState`
     * is set (e.g. "this room has no packs yet, create one" - see EmojiPicker.module.css's own
     * .emptyStateCategory for the expected shape) - the category still occupies its own rail entry
     * and header, just with this instead of a grid of Emoji cells for its body.
     */
    renderEmptyStateCategory?: (category: Category) => React.ReactNode;
}

/** Convert recent emoji characters to emoji data, removing unknowns and duplicates */
function resolveRecentEmojis(recentEmojis: string[] | undefined): IEmoji[] {
    return Array.from(
        new Set((recentEmojis ?? []).map(getEmojiFromUnicode).filter((emoji): emoji is IEmoji => !!emoji)),
    );
}

function emojiMatchesFilter(emoji: IEmoji, filter: string): boolean {
    // If the query is an emoji containing a variation then strip it to provide more useful matches
    if (filter.includes(ZERO_WIDTH_JOINER)) {
        filter = filter.split(ZERO_WIDTH_JOINER, 2)[0];
    }
    return (
        emoji.label.toLowerCase().includes(filter) ||
        (Array.isArray(emoji.emoticon)
            ? emoji.emoticon.some((x) => x.includes(filter))
            : emoji.emoticon?.includes(filter)) ||
        emoji.shortcodes.some((x) => x.toLowerCase().includes(filter)) ||
        emoji.unicode.split(ZERO_WIDTH_JOINER).includes(filter)
    );
}

/**
 * Filter the given emoji by the (already lower-cased and trimmed) query and
 * sort matches so the most relevant shortcodes come first. Returns the input
 * unchanged when the filter is empty. Never mutates the input array.
 *
 * @param emojis - The emoji to filter
 * @param lcFilter - The lower-cased and trimmed filter string
 *
 * @returns The filtered and sorted emoji
 */
export function filterEmojis(emojis: IEmoji[], lcFilter: string): IEmoji[] {
    if (lcFilter === "") return emojis;

    return emojis
        .filter((emoji) => emojiMatchesFilter(emoji, lcFilter))
        .sort((a, b) => {
            const indexA = a.shortcodes[0].indexOf(lcFilter);
            const indexB = b.shortcodes[0].indexOf(lcFilter);

            // Prioritize emojis containing the filter in its shortcode
            if (indexA == -1 || indexB == -1) {
                return indexB - indexA;
            }

            // If both emojis start with the filter
            // put the shorter emoji first
            if (indexA == 0 && indexB == 0) {
                return a.shortcodes[0].length - b.shortcodes[0].length;
            }

            // Prioritize emojis starting with the filter
            return indexA - indexB;
        });
}

/**
 * A searchable emoji picker with categories, quick reactions and keyboard
 * (roving grid) navigation.
 */
export function EmojiPicker({
    selectedEmojis,
    onChoose,
    onFinished,
    isEmojiDisabled,
    recentEmojis,
    onRecordRecent,
    getAction,
    onOpenSettings,
    showQuickReactions = true,
    extraCategories,
    dataByExtraCategory,
    mode = "emoji",
    stickerCategories,
    dataByStickerCategory,
    renderEmptyStateCategory,
    onFilterChange,
    belowSearch,
}: EmojiPickerProps): React.ReactNode {
    const [filter, setFilter] = useState("");
    const [previewEmoji, setPreviewEmoji] = useState<PickerEmoji | undefined>(undefined);
    // Track if user has interacted with arrow keys or search
    const [showHighlight, setShowHighlight] = useState(false);
    // The scroll container of the picker body, once mounted. The Virtuoso windows
    // its rows against this shared scroll parent.
    const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);

    const searchRef = useRef<HTMLInputElement>(null);
    const virtuosoRef = useRef<VirtuosoHandle>(null);

    const recentlyUsed = useMemo(() => resolveRecentEmojis(recentEmojis), [recentEmojis]);

    const lcFilter = filter.toLowerCase().trim(); // filter is case insensitive

    // Haven: the category list actually in play - stock unicode categories with extraCategories
    // spliced in right after "recent" (emoji mode), or stickerCategories alone (sticker mode, where
    // the stock unicode categories/Frequently Used/quick reactions are all meaningless - a sticker
    // can never be sent as a plain unicode m.reaction).
    const activeCategoryConfig = useMemo<Category[]>(() => {
        if (mode === "sticker") return stickerCategories ?? [];
        if (!extraCategories?.length) return CATEGORY_CONFIG;
        const recentIndex = CATEGORY_CONFIG.findIndex((cat) => cat.id === "recent");
        return [...CATEGORY_CONFIG.slice(0, recentIndex + 1), ...extraCategories, ...CATEGORY_CONFIG.slice(recentIndex + 1)];
    }, [mode, extraCategories, stickerCategories]);

    // Compute emoji to show in each category and which categories are enabled
    // (ie. non-empty, or an always-shown empty state) from the recently used list and the filter.
    const { dataByCategory, enabledCategories } = useMemo(() => {
        const dataByCategory = {} as Record<CategoryKey, PickerEmoji[]>;
        const enabledCategories: CategoryKey[] = [];

        for (const cat of activeCategoryConfig) {
            if (cat.isEmptyState) {
                dataByCategory[cat.id] = [];
                enabledCategories.push(cat.id);
                continue;
            }
            const source =
                cat.id === "recent"
                    ? recentlyUsed
                    : (dataByExtraCategory?.[cat.id] ??
                      dataByStickerCategory?.[cat.id] ??
                      DATA_BY_CATEGORY[cat.id as keyof typeof DATA_BY_CATEGORY] ??
                      []);
            const emojis = filterEmojis(source, lcFilter);
            dataByCategory[cat.id] = emojis;
            if (emojis.length > 0) {
                enabledCategories.push(cat.id);
            }
        }

        return { dataByCategory, enabledCategories };
    }, [activeCategoryConfig, lcFilter, recentlyUsed, dataByExtraCategory, dataByStickerCategory]);

    const [selectedCategory, setSelectedCategory] = useState<CategoryKey>(
        activeCategoryConfig[0]?.id ?? "recent",
    );

    const collectScrollElement = useCallback((ref: HTMLDivElement | null): void => {
        setScrollElement(ref);
    }, []);

    const itemsPerRow = mode === "sticker" ? STICKERS_PER_ROW : EMOJIS_PER_ROW;

    // Flatten into a list for virtuoso.
    const items = useMemo<ListItem[]>(() => {
        const flat: ListItem[] = [];
        for (const cat of activeCategoryConfig) {
            if (cat.isEmptyState) {
                flat.push({ type: "header", category: cat });
                flat.push({ type: "empty-state", category: cat });
                continue;
            }
            const emojis = dataByCategory[cat.id];
            if (emojis.length === 0) continue;
            flat.push({ type: "header", category: cat });
            for (let i = 0; i < emojis.length; i += itemsPerRow) {
                flat.push({ type: "row", emojis: emojis.slice(i, i + itemsPerRow), categoryId: cat.id });
            }
        }
        return flat;
    }, [activeCategoryConfig, dataByCategory, itemsPerRow]);

    const onRangeChanged = useCallback(
        (range: ListRange): void => {
            // Collect the categories that own any item within the rendered range. Each
            // flat-list entry knows its category (headers/empty-states directly, rows via
            // categoryId), so a category is visible whenever one of its entries is in range -
            // including when its header itself has scrolled out of view.
            const visibleCategoryIds = new Set<CategoryKey>();
            for (let i = range.startIndex; i <= range.endIndex; i++) {
                const item = items[i];
                if (!item) continue;
                visibleCategoryIds.add(item.type === "row" ? item.categoryId : item.category.id);
            }

            setSelectedCategory(
                activeCategoryConfig.find((cat) => visibleCategoryIds.has(cat.id))?.id ??
                    activeCategoryConfig[0]?.id ??
                    "recent",
            );
        },
        [items, activeCategoryConfig],
    );

    // Given a roving emoji button returns the role=gridcell element containing it
    const getGridcell = useCallback((rovingNode?: Element): Element | undefined => {
        return rovingNode?.parentElement ?? undefined;
    }, []);

    // Given a roving emoji button returns the role=row element containing it
    const getRow = useCallback(
        (rovingNode?: Element): Element | undefined => {
            return getGridcell(rovingNode)?.parentElement ?? undefined;
        },
        [getGridcell],
    );

    // Given a role=gridcell node returns the roving emoji button contained within
    const getRovingNode = useCallback((gridcellNode: Element): HTMLElement | undefined => {
        const node = gridcellNode.children[0];
        return node instanceof HTMLElement ? node : undefined;
    }, []);

    const onKeyDown = useCallback(
        (ev: React.KeyboardEvent, state: RovingState, dispatch: Dispatch<RovingAction>): void => {
            if (state.activeNode && ["ArrowDown", "ArrowRight", "ArrowLeft", "ArrowUp"].includes(ev.key)) {
                // If highlight is not shown yet, show it and reset to first emoji
                if (!showHighlight) {
                    setShowHighlight(true);
                    // Reset to first emoji when showing highlight for the first time (or after it was hidden)
                    if (state.nodes.length > 0) {
                        dispatch({
                            type: RovingStateActionType.SetFocus,
                            payload: { node: state.nodes[0] },
                        });
                    }
                    ev.preventDefault();
                    ev.stopPropagation();
                    return;
                }
            }
        },
        [showHighlight],
    );

    const shouldMoveFocus = useCallback((): boolean => {
        // If the search field is active, the grid will still move the selected element but we don't
        // want it to change the focus because the user trying to type in the field.
        // NB. This does still break the ability to navigate the text field with left/right arrows
        // as they change the selected emoji in the grid. This seems… bad, but I'm keeping it how it was.
        return document.activeElement !== searchRef.current;
    }, []);

    const onGridNavigation = useCallback(
        (_ev: React.KeyboardEvent, focusNode: HTMLElement, state: RovingState): void => {
            if (getRow(state.activeNode) !== getRow(focusNode)) {
                focusNode.scrollIntoView({
                    behavior: "auto",
                    block: "center",
                    inline: "center",
                });
            }
        },
        [getRow],
    );

    const scrollToCategory = useCallback(
        (category: string): void => {
            // Find the flat index of the category's header and scroll it to the top.
            const index = items.findIndex((item) => item.type === "header" && item.category.id === category);
            if (index >= 0) {
                virtuosoRef.current?.scrollToIndex({ index, align: "start" });
            }
        },
        [items],
    );

    const onChangeFilter = useCallback(
        (newFilter: string): void => {
            setFilter(newFilter);
            // User has typed a query, show highlight.
            // If the filter is cleared, hide the highlight again.
            setShowHighlight(newFilter.trim() !== "");
            onFilterChange?.(newFilter);
        },
        [onFilterChange],
    );

    const onEnterFilter = useCallback((): void => {
        // Only select emoji if highlight is shown
        if (!showHighlight) return;

        const btn = scrollElement?.querySelector<HTMLElement>('[role="gridcell"] [tabindex="0"]');
        btn?.click();
        onFinished();
    }, [showHighlight, scrollElement, onFinished]);

    const onHoverEmoji = useCallback((emoji: PickerEmoji): void => {
        setPreviewEmoji(emoji);
    }, []);

    const onHoverEmojiEnd = useCallback((): void => {
        setPreviewEmoji(undefined);
    }, []);

    const onClickEmoji = useCallback(
        (ev: ButtonEvent, emoji: PickerEmoji): void => {
            if (onChoose(emoji.unicode, emoji) !== false) {
                // Haven: an image/pack emoji already reappears in its own rail category every time
                // regardless (unlike a real emoji, which only shows up here once actually used), and
                // the plain-unicode recent store has no way to represent its mxc/pack identity
                // anyway - never fed in.
                if (!emoji.imageUrl) onRecordRecent?.(emoji.unicode);
            }
            if ((ev as React.KeyboardEvent).key === "Enter") {
                onFinished();
            }
        },
        [onChoose, onRecordRecent, onFinished],
    );

    // Base for the IDs of the individual emoji cells: the search box points at the
    // active cell with aria-activedescendant, which requires the cells to have IDs.
    // It doesn't actually matter what the ID is, provided each is unique, because
    // the search box queries the roving context for the active element and gets its ID.
    // (generate a single unique ID and then suffix because hooks can't be called in
    // a loop).
    const emojiIdBase = useId();

    const renderItem = useCallback(
        (_index: number, item: ListItem): React.ReactNode => {
            if (item.type === "header") {
                const category = item.category;
                return (
                    <div className={styles.category} data-category-id={category.id} role="gridcell">
                        <Heading as="h2" className={styles.categoryLabel}>
                            {categoryName(category)}
                        </Heading>
                    </div>
                );
            }
            if (item.type === "empty-state") {
                return (
                    <div className={styles.emptyStateCategory} data-category-id={item.category.id} role="gridcell">
                        {renderEmptyStateCategory?.(item.category)}
                    </div>
                );
            }
            return item.emojis.map((emoji) => (
                <div
                    role="gridcell"
                    className={classNames(styles.itemWrapper, { [styles.itemWrapperSticker]: mode === "sticker" })}
                    key={emoji.hexcode}
                >
                    <Emoji
                        // The category is part of the ID because the same emoji can appear both in
                        // its own category and in the recently used one.
                        id={`${emojiIdBase}-${item.categoryId}-${emoji.hexcode}`}
                        emoji={emoji}
                        selectedEmojis={selectedEmojis}
                        onClick={onClickEmoji}
                        onMouseEnter={onHoverEmoji}
                        onMouseLeave={onHoverEmojiEnd}
                        disabled={isEmojiDisabled?.(emoji.unicode)}
                    />
                </div>
            ));
        },
        [
            selectedEmojis,
            onClickEmoji,
            onHoverEmoji,
            onHoverEmojiEnd,
            isEmojiDisabled,
            emojiIdBase,
            renderEmptyStateCategory,
            mode,
        ],
    );

    const pickerBodyId = useId();

    return (
        <RovingGridIndexProvider
            getGridCell={getGridcell}
            getRow={getRow}
            getRovingNode={getRovingNode}
            handleInputFields
            moveFocus={shouldMoveFocus}
            onGridNavigation={onGridNavigation}
            onKeyDown={onKeyDown}
            getAction={getAction}
        >
            {({ onKeyDownHandler }) => (
                <section
                    className={styles.picker}
                    onKeyDown={onKeyDownHandler}
                    aria-label={_t("emoji_picker|emoji_picker")}
                >
                    <Tabs
                        categories={activeCategoryConfig}
                        enabledCategories={enabledCategories}
                        selectedCategory={selectedCategory}
                        onAnchorClick={scrollToCategory}
                        pickerBodyId={pickerBodyId}
                        getAction={getAction}
                        onOpenSettings={onOpenSettings}
                    />
                    {/* Haven: everything but the rail (Tabs above) stacked in its own column - see
                        .main/.picker's own doc in EmojiPicker.module.css. */}
                    <div className={styles.main}>
                        <Search
                            query={filter}
                            onChange={onChangeFilter}
                            onEnter={onEnterFilter}
                            onKeyDown={onKeyDownHandler}
                            inputRef={searchRef}
                            controlsId={pickerBodyId}
                        />
                        {belowSearch}
                        <AutoHideScrollbar
                            id={pickerBodyId}
                            className={classNames(styles.body, {
                                [styles.bodyShowHighlight]: showHighlight,
                            })}
                            wrappedRef={collectScrollElement}
                        >
                            {scrollElement && (
                                <Virtuoso
                                    ref={virtuosoRef}
                                    customScrollParent={scrollElement}
                                    data={items}
                                    defaultItemHeight={mode === "sticker" ? STICKER_HEIGHT : EMOJI_HEIGHT}
                                    components={gridComponents}
                                    itemContent={renderItem}
                                    rangeChanged={onRangeChanged}
                                />
                            )}
                        </AutoHideScrollbar>
                        {showQuickReactions &&
                            (previewEmoji ? (
                                <Preview emoji={previewEmoji} />
                            ) : (
                                <QuickReactions
                                    onClick={onClickEmoji}
                                    selectedEmojis={selectedEmojis}
                                    getAction={getAction}
                                />
                            ))}
                    </div>
                </section>
            )}
        </RovingGridIndexProvider>
    );
}

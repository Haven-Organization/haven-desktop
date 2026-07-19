/*
Copyright 2024 New Vector Ltd.
Copyright 2020 The Matrix.org Foundation C.I.C.
Copyright 2019 Tulir Asokan <tulir@maunium.net>

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type Dispatch } from "react";
import { DATA_BY_CATEGORY, getEmojiFromUnicode, type Emoji as IEmoji } from "@matrix-org/emojibase-bindings";
import classNames from "classnames";
import { AutoHideScrollbar } from "@element-hq/web-shared-components";
import { type Room } from "matrix-js-sdk/src/matrix";

import { _t } from "../../../languageHandler";
import * as recent from "../../../emojipicker/recent";
import Header from "./Header";
import Search from "./Search";
import Preview from "./Preview";
import QuickReactions from "./QuickReactions";
import Category, { type CategoryKey, type ICategory } from "./Category";
import {
    type IAction as RovingAction,
    type IState as RovingState,
    RovingGridIndexProvider,
    RovingStateActionType,
} from "../../../accessibility/RovingTabIndex";
import { Key } from "../../../Keyboard";
import AccessibleButton, { type ButtonEvent } from "../elements/AccessibleButton";
import { type CustomEmojiChoice, makeCustomEmoji, isCustomEmoji } from "./customEmoji";
import {
    type ImagePackUsage,
    type RoomImagePack,
    getEmoticonPacks,
    getPackAvatarMxc,
    imagesForUsage,
    packDisplayName,
} from "../../../utils/ImagePacks";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { UserTab } from "../dialogs/UserTab";

export const CATEGORY_HEADER_HEIGHT = 20;
export const EMOJI_HEIGHT = 35;
export const EMOJIS_PER_ROW = 8;
// Haven: stickers get a visibly bigger grid slot than emoji - same row width (304px, see
// _EmojiPicker.pcss's own doc on that figure), just 4 wider cells instead of 8 narrower ones, at
// roughly the same width:height ratio as the emoji grid's own 38:35.
export const STICKER_HEIGHT = 70;
export const STICKERS_PER_ROW = 4;

const ZERO_WIDTH_JOINER = "\u200D";

interface IProps {
    selectedEmojis?: Set<string>;
    onChoose(unicode: string, custom?: CustomEmojiChoice): boolean;
    onFinished(): void;
    isEmojiDisabled?: (unicode: string) => boolean;
    /**
     * When true, show a "React with '<text>'" option below the search box, sending whatever's
     * typed as a literal freeform m.reaction key (Enter, or clicking the option, both trigger it) —
     * only meaningful where onChoose actually sends a reaction (ReactionPicker), not plain
     * emoji-insert-into-composer usage (EmojiButton), so this defaults to off there.
     */
    allowFreeformReaction?: boolean;
    /**
     * Haven: the room this picker is being shown for - lets it show that room's own MSC2545 image
     * packs (plus the user's favorited packs from other rooms) as extra rail categories, between
     * Frequently Used and Smileys and People. Omit entirely (e.g. no room context available) to
     * fall back to the plain stock unicode-only picker.
     */
    room?: Room;
    /**
     * Haven: "emoji" (default) shows the normal unicode categories plus any emoji/both image
     * packs. "sticker" replaces the whole picker with sticker/both image packs only - stock
     * unicode categories, Frequently Used, and Quick Reactions are all meaningless for stickers
     * (which can never be sent as m.reaction) and are hidden entirely in this mode.
     */
    mode?: "emoji" | "sticker";
}

interface IState {
    filter: string;
    previewEmoji?: IEmoji;
    scrollTop: number;
    // initial estimation of height, dialog is hardcoded to 450px height.
    // should be enough to never have blank rows of emojis as
    // 3 rows of overflow are also rendered. The actual value is updated on scroll.
    viewportHeight: number;
    // Track if user has interacted with arrow keys or search
    showHighlight: boolean;
}

// A previously-sent freeform reaction (see EmojiPicker's allowFreeformReaction) isn't a real
// emoji, so getEmojiFromUnicode can't find it — build a minimal stand-in IEmoji instead of
// dropping it, so it can flow through the exact same Category/Emoji rendering as a real one.
// hexcode only needs to be a stable, unique React key here, not a real codepoint.
function makeFreeformEmoji(text: string): IEmoji {
    return {
        unicode: text,
        label: text,
        shortcodes: [text],
        hexcode: `freeform-${text}`,
    } as IEmoji;
}

/** Haven: pack categories to splice between Frequently Used and Smileys and People (emoji mode),
 *  or the entire category list (sticker mode, where the stock unicode categories/Quick Reactions
 *  don't apply at all - see IProps.mode's own doc). Room packs sort before the user's favorited
 *  packs (a favorited pack that's also this room's own is only shown once, as a room pack, not
 *  duplicated) - both requirements straight from how this feature was specced. */
function buildPackCategories(
    room: Room | undefined,
    usage: ImagePackUsage,
): { categories: Pick<ICategory, "id" | "name" | "emoji" | "iconUrl">[]; dataByCategory: Record<string, IEmoji[]> } {
    if (!room) return { categories: [], dataByCategory: {} };

    const packs: RoomImagePack[] = getEmoticonPacks(room, usage);

    const categories: Pick<ICategory, "id" | "name" | "emoji" | "iconUrl">[] = [];
    const dataByCategory: Record<string, IEmoji[]> = {};
    for (const pack of packs) {
        const id = `pack:${pack.roomId}:${pack.stateKey}`;
        const name = packDisplayName(pack.content, pack.stateKey);
        // getPackAvatarMxc resolves own avatar -> source room's avatar -> first image in the pack;
        // a favorited pack from a room other than the currently open one still resolves against its
        // own room, not this one, since it reads pack.roomId itself rather than assuming `room`.
        const iconUrl = getPackAvatarMxc(pack, room.client);
        categories.push({ id, name, emoji: "🖼️", iconUrl });
        dataByCategory[id] = imagesForUsage(pack, usage).map(({ shortcode, image }) =>
            makeCustomEmoji(shortcode, image.url, name, pack.roomId, pack.stateKey, image.info),
        );
    }
    return { categories, dataByCategory };
}

class EmojiPicker extends React.Component<IProps, IState> {
    private readonly recentlyUsed: IEmoji[];
    private readonly freeformRecentUnicodes: Set<string>;
    private readonly memoizedDataByCategory: Record<CategoryKey, IEmoji[]>;
    // Haven: memoizedDataByCategory gets overwritten in place with filtered results as the user
    // types (see onChangeFilter), so pack categories' original data needs to survive here too -
    // DATA_BY_CATEGORY only covers the stock unicode categories, not `pack:...` ones.
    private readonly packDataByCategory: Record<string, IEmoji[]>;
    private readonly categories: ICategory[];

    private scrollElement: HTMLDivElement | null = null;

    public constructor(props: IProps) {
        super(props);

        this.state = {
            filter: "",
            scrollTop: 0,
            viewportHeight: 280,
            showHighlight: false,
        };

        const stickerMode = props.mode === "sticker";
        const packUsage: ImagePackUsage = stickerMode ? "sticker" : "emoticon";
        const { categories: packCategoryConfig, dataByCategory: packDataByCategory } = buildPackCategories(
            props.room,
            packUsage,
        );

        if (stickerMode) {
            // Stock unicode categories/Frequently Used/Quick Reactions don't apply to stickers at
            // all (a sticker is never sent as m.reaction, so there's no "frequently reacted with"
            // concept for it either) - the whole picker is just this room's + the user's favorited
            // sticker packs, nothing else.
            this.recentlyUsed = [];
            this.freeformRecentUnicodes = new Set();
            this.memoizedDataByCategory = packDataByCategory;
            this.packDataByCategory = packDataByCategory;
            this.categories = packCategoryConfig.map((config, i) => ({
                ...config,
                enabled: true,
                visible: i === 0,
                firstVisible: i === 0,
                ref: React.createRef(),
            }));
            return;
        }

        // Convert recent emoji characters to emoji data, removing duplicates. A recent entry that
        // isn't a real known emoji is a previously-sent freeform reaction — kept (as a stand-in
        // IEmoji) rather than dropped like an actual unknown/removed emoji would be.
        const freeformRecentUnicodes = new Set<string>();
        this.recentlyUsed = Array.from(
            new Set(
                recent.get().map((entry) => {
                    const emoji = getEmojiFromUnicode(entry);
                    if (emoji) return emoji;
                    freeformRecentUnicodes.add(entry);
                    return makeFreeformEmoji(entry);
                }),
            ),
        );
        this.freeformRecentUnicodes = freeformRecentUnicodes;
        this.packDataByCategory = packDataByCategory;
        this.memoizedDataByCategory = {
            recent: this.recentlyUsed,
            ...DATA_BY_CATEGORY,
            ...packDataByCategory,
        };

        const hasRecentlyUsed = this.recentlyUsed.length > 0;

        const categoryConfig: Pick<ICategory, "id" | "name" | "emoji" | "iconUrl">[] = [
            { id: "recent", name: _t("emoji|category_frequently_used"), emoji: "🕒" },
            // Haven: this room's + the user's favorited emoji/both image packs go here, between
            // Frequently Used and Smileys and People - see buildPackCategories's own doc.
            ...packCategoryConfig,
            { id: "people", name: _t("emoji|category_smileys_people"), emoji: "😀" },
            { id: "nature", name: _t("emoji|category_animals_nature"), emoji: "🐕" },
            { id: "foods", name: _t("emoji|category_food_drink"), emoji: "🍎" },
            { id: "activity", name: _t("emoji|category_activities"), emoji: "⚽️" },
            { id: "places", name: _t("emoji|category_travel_places"), emoji: "🚗" },
            { id: "objects", name: _t("emoji|category_objects"), emoji: "💡" },
            { id: "symbols", name: _t("emoji|category_symbols"), emoji: "⁉️" },
            { id: "flags", name: _t("emoji|category_flags"), emoji: "🏁" },
        ];

        const packCategoryIds = new Set(packCategoryConfig.map((c) => c.id));
        this.categories = categoryConfig.map((config) => {
            let isEnabled = true;
            let isVisible = false;
            let firstVisible = false;
            if (config.id === "recent") {
                isEnabled = hasRecentlyUsed;
                isVisible = hasRecentlyUsed;
                firstVisible = hasRecentlyUsed;
            } else if (packCategoryIds.has(config.id)) {
                // Same "always shown, self-corrects on first real scroll measurement" tolerance as
                // "people" below - not worth resolving exactly which of recent/packs/people is the
                // true first-scrolled-to section before updateVisibility's own DOM measurement
                // runs.
                isVisible = true;
            } else if (config.id === "people") {
                isVisible = true;
                firstVisible = !hasRecentlyUsed && packCategoryConfig.length === 0;
            }
            return {
                ...config,
                enabled: isEnabled,
                visible: isVisible,
                firstVisible: firstVisible,
                ref: React.createRef(),
            };
        });
    }

    private onScroll = (): void => {
        const body = this.scrollElement;
        if (!body) return;
        this.setState({
            scrollTop: body.scrollTop,
            viewportHeight: body.clientHeight,
        });
        this.updateVisibility();
    };

    // Given a roving emoji button returns the role=row element containing it
    private readonly getRow = (rovingNode?: Element): Element | undefined => {
        return this.getGridcell(rovingNode)?.parentElement ?? undefined;
    };

    // Given a roving emoji button returns the role=gridcell element containing it
    private readonly getGridcell = (rovingNode?: Element): Element | undefined => {
        return rovingNode?.parentElement ?? undefined;
    };

    // Given a role=gridcell node returns the roving emoji button contained within
    private readonly getRovingNode = (gridcellNode: Element): HTMLElement | undefined => {
        const node = gridcellNode.children[0];
        return node instanceof HTMLElement ? node : undefined;
    };

    private onKeyDown = (ev: React.KeyboardEvent, state: RovingState, dispatch: Dispatch<RovingAction>): void => {
        if (state.activeNode && [Key.ARROW_DOWN, Key.ARROW_RIGHT, Key.ARROW_LEFT, Key.ARROW_UP].includes(ev.key)) {
            // If highlight is not shown yet, show it and reset to first emoji
            if (!this.state.showHighlight) {
                this.setState({ showHighlight: true });
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
    };

    private readonly shouldMoveFocus = (): boolean => {
        return document.activeElement !== document.querySelector(".mx_EmojiPicker_search input");
    };

    private readonly onGridNavigation = (ev: React.KeyboardEvent, focusNode: HTMLElement, state: RovingState): void => {
        if (this.getRow(state.activeNode) !== this.getRow(focusNode)) {
            focusNode.scrollIntoView({
                behavior: "auto",
                block: "center",
                inline: "center",
            });
        }
    };

    private updateVisibility = (): void => {
        const body = this.scrollElement;
        if (!body) return;
        const rect = body.getBoundingClientRect();
        let firstVisibleFound = false;
        for (const cat of this.categories) {
            const elem = body.querySelector(`[data-category-id="${cat.id}"]`);
            if (!elem) {
                cat.visible = false;
                cat.ref.current?.classList.remove("mx_EmojiPicker_anchor_visible");
                continue;
            }
            const elemRect = elem.getBoundingClientRect();
            const y = elemRect.y - rect.y;
            const yEnd = elemRect.y + elemRect.height - rect.y;
            cat.visible = y < rect.height && yEnd > 0;
            if (cat.visible && !firstVisibleFound) {
                firstVisibleFound = true;
                cat.firstVisible = true;
            } else {
                cat.firstVisible = false;
            }
            // We update this here instead of through React to avoid re-render on scroll.
            if (!cat.ref.current) continue;
            if (cat.visible) {
                cat.ref.current.classList.add("mx_EmojiPicker_anchor_visible");
                cat.ref.current.setAttribute("aria-selected", "true");
            } else {
                cat.ref.current.classList.remove("mx_EmojiPicker_anchor_visible");
                cat.ref.current.setAttribute("aria-selected", "false");
            }
            if (cat.firstVisible) {
                cat.ref.current.setAttribute("tabindex", "0");
            } else {
                cat.ref.current.setAttribute("tabindex", "-1");
            }
        }
    };

    private scrollToCategory = (category: string): void => {
        this.scrollElement?.querySelector(`[data-category-id="${category}"]`)?.scrollIntoView();
    };

    // Haven: sticker mode has nothing else to fall back on (unlike emoji mode, which always has
    // the stock unicode categories) - a room with no own sticker packs and no favorited ones would
    // otherwise render a totally blank body. onFinished closes the picker, since the link is
    // navigating away to Settings rather than picking anything.
    private onOpenFavoritePacks = (): void => {
        this.props.onFinished();
        dis.dispatch({
            action: Action.ViewUserSettings,
            initialTabId: UserTab.EmojiStickers,
        });
    };

    private onChangeFilter = (filter: string): void => {
        const lcFilter = filter.toLowerCase().trim(); // filter is case insensitive

        // User has typed a query, show highlight
        // If filter is cleared, hide highlight again
        if (lcFilter && !this.state.showHighlight) {
            this.setState({ showHighlight: true });
        } else if (!lcFilter && this.state.showHighlight) {
            this.setState({ showHighlight: false });
        }

        for (const cat of this.categories) {
            let emojis: IEmoji[];
            // If the new filter string includes the old filter string, we don't have to re-filter the whole dataset.
            if (lcFilter.includes(this.state.filter)) {
                emojis = this.memoizedDataByCategory[cat.id];
            } else {
                emojis =
                    cat.id === "recent"
                        ? this.recentlyUsed
                        : (DATA_BY_CATEGORY[cat.id] ?? this.packDataByCategory[cat.id]);
            }

            if (lcFilter !== "") {
                emojis = emojis.filter((emoji) => this.emojiMatchesFilter(emoji, lcFilter));
                // Copy the array to not clobber the original unfiltered sorting
                emojis = [...emojis].sort((a, b) => {
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

            this.memoizedDataByCategory[cat.id] = emojis;
            cat.enabled = emojis.length > 0;
            // The setState below doesn't re-render the header and we already have the refs for updateVisibility, so...
            if (cat.ref.current) {
                cat.ref.current.disabled = !cat.enabled;
            }
        }
        this.setState({ filter });
        // Header underlines need to be updated, but updating requires knowing
        // where the categories are, so we wait for a tick.
        window.setTimeout(this.updateVisibility, 0);
    };

    private emojiMatchesFilter = (emoji: IEmoji, filter: string): boolean => {
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
    };

    // Distinguishes a synthetic freeform "recent" entry (see makeFreeformEmoji) from a real emoji,
    // so Emoji.tsx can style it to fit its fixed-size grid slot instead of overflowing it.
    private isFreeformEmoji = (unicode: string): boolean => {
        return this.freeformRecentUnicodes.has(unicode);
    };

    private onEnterFilter = (): void => {
        // A real emoji match wins over the freeform reaction whenever the search still has one -
        // Enter should react with whatever's actually highlighted first, same as it always did
        // before freeform reactions existed. Freeform is only the fallback once the query has
        // narrowed the results down to nothing (a query that was never going to match a real emoji
        // at all, e.g. an arbitrary phrase), not a blanket override of a real match.
        if (this.state.showHighlight) {
            const btn = this.scrollElement?.querySelector<HTMLButtonElement>('.mx_EmojiPicker_item_wrapper [tabindex="0"]');
            if (btn) {
                btn.click();
                this.props.onFinished();
                return;
            }
        }

        if (this.props.allowFreeformReaction && this.state.filter.trim()) {
            this.onClickFreeformReact();
        }
    };

    // The freeform reaction option isn't part of the roving-tabindex emoji grid (it lives outside
    // the scrollable results, right under the search box, matching where a typed query's own
    // "result" should read), so it's handled as a plain click/Enter action here rather than via
    // the grid's own click/keyboard machinery in onClickEmoji/onEnterFilter's btn-click path.
    private onClickFreeformReact = (): void => {
        const text = this.state.filter.trim();
        if (!text) return;
        if (this.props.onChoose(text) !== false) {
            // So it shows up in Frequently Used next time the picker opens, same as a real emoji
            // pick below in onClickEmoji.
            recent.add(text);
        }
        this.props.onFinished();
    };

    private onHoverEmoji = (emoji: IEmoji): void => {
        this.setState({
            previewEmoji: emoji,
        });
    };

    private onHoverEmojiEnd = (): void => {
        this.setState({
            previewEmoji: undefined,
        });
    };

    private onClickEmoji = (ev: ButtonEvent, emoji: IEmoji): void => {
        if (isCustomEmoji(emoji)) {
            // Not fed into the plain-unicode "recent" store - it has no way to represent a custom
            // emoji's mxc/pack identity, and this pack already shows up in its own rail category
            // every time regardless (unlike a real emoji, which only reappears here once actually
            // used) - see makeCustomEmoji/CustomEmojiChoice's own doc.
            this.props.onChoose(emoji.unicode, {
                shortcode: emoji.shortcodes[0],
                mxcUrl: emoji.mxcUrl,
                packName: emoji.packName,
                roomId: emoji.roomId,
                stateKey: emoji.stateKey,
                imageInfo: emoji.imageInfo,
            });
        } else if (this.props.onChoose(emoji.unicode) !== false) {
            recent.add(emoji.unicode);
        }
        if ((ev as React.KeyboardEvent).key === Key.ENTER) {
            this.props.onFinished();
        }
    };

    private static categoryHeightForEmojiCount(count: number, itemsPerRow: number, itemHeight: number): number {
        if (count === 0) {
            return 0;
        }
        return CATEGORY_HEADER_HEIGHT + Math.ceil(count / itemsPerRow) * itemHeight;
    }

    public render(): React.ReactNode {
        return (
            <RovingGridIndexProvider
                getGridCell={this.getGridcell}
                getRow={this.getRow}
                getRovingNode={this.getRovingNode}
                handleInputFields
                moveFocus={this.shouldMoveFocus}
                onGridNavigation={this.onGridNavigation}
                onKeyDown={this.onKeyDown}
            >
                {({ onKeyDownHandler }) => {
                    let heightBefore = 0;
                    const itemsPerRow = this.props.mode === "sticker" ? STICKERS_PER_ROW : EMOJIS_PER_ROW;
                    const itemHeight = this.props.mode === "sticker" ? STICKER_HEIGHT : EMOJI_HEIGHT;
                    return (
                        <section
                            className="mx_EmojiPicker"
                            data-testid="mx_EmojiPicker"
                            onKeyDown={onKeyDownHandler}
                            aria-label={_t("a11y|emoji_picker")}
                        >
                            <Header categories={this.categories} onAnchorClick={this.scrollToCategory} />
                            <div className="mx_EmojiPicker_main">
                                <Search
                                    query={this.state.filter}
                                    onChange={this.onChangeFilter}
                                    onEnter={this.onEnterFilter}
                                    onKeyDown={onKeyDownHandler}
                                />
                                {this.props.allowFreeformReaction && this.state.filter.trim() && (
                                    <AccessibleButton
                                        kind="link"
                                        className="mx_EmojiPicker_freeformReact"
                                        onClick={this.onClickFreeformReact}
                                    >
                                        {_t("emoji_picker|react_with_text", { text: this.state.filter.trim() })}
                                    </AccessibleButton>
                                )}
                                {this.props.mode === "sticker" && this.categories.length === 0 ? (
                                    <div className="mx_EmojiPicker_empty">
                                        {_t(
                                            "emoji_picker|no_stickers_in_room",
                                            {},
                                            {
                                                a: (sub) => (
                                                    <AccessibleButton
                                                        kind="link_inline"
                                                        onClick={this.onOpenFavoritePacks}
                                                    >
                                                        {sub}
                                                    </AccessibleButton>
                                                ),
                                            },
                                        )}
                                    </div>
                                ) : (
                                    <AutoHideScrollbar
                                        id="mx_EmojiPicker_body"
                                        className={classNames("mx_AutoHideScrollbar mx_EmojiPicker_body", {
                                            mx_EmojiPicker_body_showHighlight: this.state.showHighlight,
                                        })}
                                        wrappedRef={(ref) => {
                                            this.scrollElement = ref;
                                        }}
                                        onScroll={this.onScroll}
                                    >
                                        {this.categories.map((category) => {
                                            const emojis = this.memoizedDataByCategory[category.id];
                                            const categoryElement = (
                                                <Category
                                                    key={category.id}
                                                    id={category.id}
                                                    name={category.name}
                                                    heightBefore={heightBefore}
                                                    viewportHeight={this.state.viewportHeight}
                                                    scrollTop={this.state.scrollTop}
                                                    emojis={emojis}
                                                    onClick={this.onClickEmoji}
                                                    onMouseEnter={this.onHoverEmoji}
                                                    onMouseLeave={this.onHoverEmojiEnd}
                                                    isEmojiDisabled={this.props.isEmojiDisabled}
                                                    isFreeformEmoji={this.isFreeformEmoji}
                                                    selectedEmojis={this.props.selectedEmojis}
                                                    itemsPerRow={itemsPerRow}
                                                    itemHeight={itemHeight}
                                                />
                                            );
                                            const height = EmojiPicker.categoryHeightForEmojiCount(
                                                emojis.length,
                                                itemsPerRow,
                                                itemHeight,
                                            );
                                            heightBefore += height;
                                            return categoryElement;
                                        })}
                                    </AutoHideScrollbar>
                                )}
                                {this.state.previewEmoji ? (
                                    <Preview emoji={this.state.previewEmoji} />
                                ) : this.props.mode !== "sticker" ? (
                                    <QuickReactions
                                        onClick={this.onClickEmoji}
                                        selectedEmojis={this.props.selectedEmojis}
                                    />
                                ) : (
                                    // Haven: sticker mode has no QuickReactions fallback to occupy this
                                    // footer slot while nothing's hovered, so without this placeholder the
                                    // grid area above grows/shrinks by exactly Preview's height on every
                                    // hover/unhover. If the hovered row sits within that band while scrolled
                                    // to the bottom, the resulting layout shift moves the row out from under
                                    // the cursor, firing mouseleave (hiding Preview, growing the grid back,
                                    // moving the row back under the cursor, re-triggering mouseenter) - an
                                    // infinite hover flicker loop. Reserving the same footer height
                                    // regardless of hover state removes the feedback loop entirely.
                                    <div className="mx_EmojiPicker_footer" />
                                )}
                            </div>
                        </section>
                    );
                }}
            </RovingGridIndexProvider>
        );
    }
}

export default EmojiPicker;

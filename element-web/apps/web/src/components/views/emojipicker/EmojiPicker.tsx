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

export const CATEGORY_HEADER_HEIGHT = 20;
export const EMOJI_HEIGHT = 35;
export const EMOJIS_PER_ROW = 8;

const ZERO_WIDTH_JOINER = "\u200D";

interface IProps {
    selectedEmojis?: Set<string>;
    onChoose(unicode: string): boolean;
    onFinished(): void;
    isEmojiDisabled?: (unicode: string) => boolean;
    /**
     * When true, show a "React with '<text>'" option below the search box, sending whatever's
     * typed as a literal freeform m.reaction key (Enter, or clicking the option, both trigger it) —
     * only meaningful where onChoose actually sends a reaction (ReactionPicker), not plain
     * emoji-insert-into-composer usage (EmojiButton), so this defaults to off there.
     */
    allowFreeformReaction?: boolean;
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

class EmojiPicker extends React.Component<IProps, IState> {
    private readonly recentlyUsed: IEmoji[];
    private readonly freeformRecentUnicodes: Set<string>;
    private readonly memoizedDataByCategory: Record<CategoryKey, IEmoji[]>;
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
        this.memoizedDataByCategory = {
            recent: this.recentlyUsed,
            ...DATA_BY_CATEGORY,
        };

        const hasRecentlyUsed = this.recentlyUsed.length > 0;

        const categoryConfig: Pick<ICategory, "id" | "name" | "emoji">[] = [
            { id: "recent", name: _t("emoji|category_frequently_used"), emoji: "🕒" },
            { id: "people", name: _t("emoji|category_smileys_people"), emoji: "😀" },
            { id: "nature", name: _t("emoji|category_animals_nature"), emoji: "🐕" },
            { id: "foods", name: _t("emoji|category_food_drink"), emoji: "🍎" },
            { id: "activity", name: _t("emoji|category_activities"), emoji: "⚽️" },
            { id: "places", name: _t("emoji|category_travel_places"), emoji: "🚗" },
            { id: "objects", name: _t("emoji|category_objects"), emoji: "💡" },
            { id: "symbols", name: _t("emoji|category_symbols"), emoji: "⁉️" },
            { id: "flags", name: _t("emoji|category_flags"), emoji: "🏁" },
        ];

        this.categories = categoryConfig.map((config) => {
            let isEnabled = true;
            let isVisible = false;
            let firstVisible = false;
            if (config.id === "recent") {
                isEnabled = hasRecentlyUsed;
                isVisible = hasRecentlyUsed;
                firstVisible = hasRecentlyUsed;
            } else if (config.id === "people") {
                isVisible = true;
                firstVisible = !hasRecentlyUsed;
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
                emojis = cat.id === "recent" ? this.recentlyUsed : DATA_BY_CATEGORY[cat.id];
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
        if (this.props.onChoose(emoji.unicode) !== false) {
            recent.add(emoji.unicode);
        }
        if ((ev as React.KeyboardEvent).key === Key.ENTER) {
            this.props.onFinished();
        }
    };

    private static categoryHeightForEmojiCount(count: number): number {
        if (count === 0) {
            return 0;
        }
        return CATEGORY_HEADER_HEIGHT + Math.ceil(count / EMOJIS_PER_ROW) * EMOJI_HEIGHT;
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
                    return (
                        <section
                            className="mx_EmojiPicker"
                            data-testid="mx_EmojiPicker"
                            onKeyDown={onKeyDownHandler}
                            aria-label={_t("a11y|emoji_picker")}
                        >
                            <Header categories={this.categories} onAnchorClick={this.scrollToCategory} />
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
                                        />
                                    );
                                    const height = EmojiPicker.categoryHeightForEmojiCount(emojis.length);
                                    heightBefore += height;
                                    return categoryElement;
                                })}
                            </AutoHideScrollbar>
                            {this.state.previewEmoji ? (
                                <Preview emoji={this.state.previewEmoji} />
                            ) : (
                                <QuickReactions
                                    onClick={this.onClickEmoji}
                                    selectedEmojis={this.props.selectedEmojis}
                                />
                            )}
                        </section>
                    );
                }}
            </RovingGridIndexProvider>
        );
    }
}

export default EmojiPicker;

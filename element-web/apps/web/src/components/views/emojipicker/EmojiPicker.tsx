/*
Copyright 2024 New Vector Ltd.
Copyright 2020 The Matrix.org Foundation C.I.C.
Copyright 2019 Tulir Asokan <tulir@maunium.net>

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
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
    checkInputableElement,
    type IState as RovingState,
    jkArrowEquivalent,
    RovingGridIndexProvider,
} from "../../../accessibility/RovingTabIndex";
import { Key } from "../../../Keyboard";
import AccessibleButton, { type ButtonEvent } from "../elements/AccessibleButton";
import { type CustomEmojiChoice, makeCustomEmoji, isCustomEmoji } from "./customEmoji";
import {
    type ImagePackUsage,
    type RoomImagePack,
    getEmoticonPacks,
    getRoomImagePacks,
    getPackAvatarMxc,
    canManageImagePacks,
    imagesForUsage,
    packDisplayName,
} from "../../../utils/ImagePacks";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { UserTab } from "../dialogs/UserTab";
import { RoomSettingsTab } from "../dialogs/RoomSettingsDialog-tab";
import { setPendingManagePackStateKey } from "../../../utils/pendingManagePack";
import {
    CATEGORY_HEADER_HEIGHT,
    EMOJI_HEIGHT,
    EMOJIS_PER_ROW,
    STICKER_HEIGHT,
    STICKERS_PER_ROW,
} from "./config";

// Haven: fixed body height for the synthetic "create a pack" placeholder category (see
// buildPackCategories) - it has no real emoji/sticker grid to size itself from, unlike every other
// category, so categoryHeightForEmojiCount's row-count math doesn't apply to it.
const CREATE_PACK_PLACEHOLDER_HEIGHT = 112;

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
    /**
     * Haven: hides this room's own custom emoji pack categories in "emoji" mode (no effect in
     * "sticker" mode, which sends a chosen sticker directly - see EmojiButton.tsx's own
     * onChooseSticker - and never touches composer text insertion at all). Set by EmojiButton.tsx
     * when the caller (see wysiwyg_composer/components/Emoji.tsx's own doc) is composing in the
     * true rich-text editor, whose underlying @vector-im/matrix-wysiwyg crate has no way to insert
     * a custom emoji as anything but literal `:shortcode:` text (confirmed live 2026-07-22, including
     * that repurposing its mention() pill API for this doesn't work either - see
     * useWysiwygSendActionHandler.ts's own doc) - hiding the option entirely beats silently sending
     * something that looks broken.
     */
    disableCustomEmoji?: boolean;
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
 *  duplicated) - both requirements straight from how this feature was specced.
 *
 *  If `room` itself has no packs of its own at all (favorited packs from elsewhere don't count -
 *  getRoomImagePacks, not getEmoticonPacks, deliberately checked unfiltered by usage: this is
 *  about whether the room has *any* pack, not one usable for this specific usage) and the current
 *  user could create one, an extra synthetic "create a pack" placeholder category is appended,
 *  using the room's own avatar - mirrors Discord's own "your server has no stickers yet" nudge. */
function buildPackCategories(
    room: Room | undefined,
    usage: ImagePackUsage,
): {
    categories: Pick<
        ICategory,
        "id" | "name" | "emoji" | "iconUrl" | "manageRoomId" | "manageStateKey" | "isCreatePlaceholder"
    >[];
    dataByCategory: Record<string, IEmoji[]>;
} {
    if (!room) return { categories: [], dataByCategory: {} };

    const userId = room.client.getSafeUserId();
    const packs: RoomImagePack[] = getEmoticonPacks(room, usage);

    const categories: Pick<
        ICategory,
        "id" | "name" | "emoji" | "iconUrl" | "manageRoomId" | "manageStateKey" | "isCreatePlaceholder"
    >[] = [];
    const dataByCategory: Record<string, IEmoji[]> = {};
    for (const pack of packs) {
        const id = `pack:${pack.roomId}:${pack.stateKey}`;
        const name = packDisplayName(pack.content, pack.stateKey);
        // getPackAvatarMxc resolves own avatar -> source room's avatar -> first image in the pack;
        // a favorited pack from a room other than the currently open one still resolves against its
        // own room, not this one, since it reads pack.roomId itself rather than assuming `room`.
        const iconUrl = getPackAvatarMxc(pack, room.client);
        // A favorited pack's own room may differ from `room` (the room this picker was opened
        // for) - permission is always checked against the pack's actual source room.
        const packRoom = room.client.getRoom(pack.roomId);
        const manageRoomId = packRoom && canManageImagePacks(packRoom, userId) ? pack.roomId : undefined;
        categories.push({
            id,
            name,
            emoji: "🖼️",
            iconUrl,
            manageRoomId,
            manageStateKey: manageRoomId ? pack.stateKey : undefined,
        });
        dataByCategory[id] = imagesForUsage(pack, usage).map(({ shortcode, image }) =>
            makeCustomEmoji(shortcode, image.url, name, pack.roomId, pack.stateKey, image.info),
        );
    }

    if (getRoomImagePacks(room).length === 0 && canManageImagePacks(room, userId)) {
        const id = `pack-create:${room.roomId}`;
        categories.push({
            id,
            name: room.name,
            emoji: "🖼️",
            iconUrl: room.getMxcAvatarUrl() ?? undefined,
            isCreatePlaceholder: true,
        });
        dataByCategory[id] = [];
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
    // Haven: scoped root for focusFirstItem's own query below, rather than a bare
    // document.querySelector - this component can be mounted more than once at a time (a reaction
    // picker open alongside the composer's own emoji/sticker picker), and only this instance's own
    // first item should ever be focused.
    private readonly rootRef = React.createRef<HTMLElement>();

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
        const packRoom = !stickerMode && props.disableCustomEmoji ? undefined : props.room;
        const { categories: packCategoryConfig, dataByCategory: packDataByCategory } = buildPackCategories(
            packRoom,
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

    private onKeyDown = (ev: React.KeyboardEvent, state: RovingState): void => {
        // Haven: this handler runs before RovingGridIndexProvider's own checkInputableElement
        // gating (it's invoked as that provider's own `onKeyDown` prop, which always fires first -
        // see the shared onGridKeyDown implementation), so the h/j/k/l check below needs its own
        // text-input guard rather than relying on the provider to skip it for us. Real arrow keys
        // don't need this - they're never something someone would be typing into the search box.
        const isVimKey = !checkInputableElement(ev.target as HTMLElement) && !!jkArrowEquivalent(ev);
        const isArrowKey = [Key.ARROW_DOWN, Key.ARROW_RIGHT, Key.ARROW_LEFT, Key.ARROW_UP].includes(ev.key) || isVimKey;
        if (state.activeNode && isArrowKey) {
            // Haven: this used to also dispatch a SetFocus to state.nodes[0] here, forcing the
            // roving group's active node back to the very first item on the very first arrow press
            // of a session (showHighlight starts false and only flips true here or on typing a
            // filter). That desynced the roving state from real DOM focus whenever the user had
            // already focused a different item first (e.g. by clicking a custom pack emoji), since
            // it never called .focus() on the reset target - so the *next* arrow press computed
            // navigation from the wrong node while focus visibly stayed put, then jumped somewhere
            // unrelated once a target finally resolved. This was reported as "pressing up from the
            // top of a custom pack keeps moving back down". Just reveal the highlight ring around
            // whatever's already active instead of moving anything.
            if (!this.state.showHighlight) {
                this.setState({ showHighlight: true });
                ev.preventDefault();
                ev.stopPropagation();
                return;
            }
        }

        // Haven: Tab from the sticker picker's search box jumps straight to the first sticker
        // instead of following the browser's native tab order (which would otherwise leave the
        // picker or land on the "clear search" button) - lets someone open the picker, glance at
        // the search box, and get straight into HJKL/arrow-key navigation with a single Tab press.
        // Scoped to sticker mode only (that's the specific ask - the emoji picker's own search box
        // keeps its native Tab order) and to a plain forward Tab from the search input specifically
        // (not Shift+Tab, and not from somewhere already inside the grid, where native Tab
        // behaviour is already fine).
        if (
            this.props.mode === "sticker" &&
            ev.key === Key.TAB &&
            !ev.shiftKey &&
            ev.target instanceof HTMLInputElement &&
            this.focusFirstItem()
        ) {
            ev.preventDefault();
            ev.stopPropagation();
        }
    };

    // Haven: see the Tab-handling block in onKeyDown above for why this exists. Queries the DOM
    // directly for the first roving item rather than going through the roving-tabindex reducer
    // state (not reachable from here - RovingGridIndexProvider only exposes it inside its own
    // render-prop scope) - every registered item already renders with a stable, unique id
    // (mx_EmojiPicker_item_<hexcode>), so the first one in DOM order is reliably "the first item"
    // without needing that state. Not virtualized (categories render their real DOM nodes up
    // front, just visibility-tracked for the header highlight - see updateVisibility), so this is
    // always available synchronously, with no need to wait for anything to mount lazily. Returns
    // whether an item was actually found/focused, so the caller can leave native Tab behaviour
    // alone (e.g. an empty picker with no packs at all) rather than swallowing the key for nothing.
    private focusFirstItem(): boolean {
        const firstItem = this.rootRef.current?.querySelector<HTMLElement>('[id^="mx_EmojiPicker_item_"]');
        firstItem?.focus();
        return !!firstItem;
    }

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

    // Haven: opens the user's own Emoji & Stickers settings (favorite packs, etc.) - used by the
    // rail's trailing settings button (always available) and, in sticker mode, by the "no packs at
    // all" empty-state link (sticker mode has nothing else to fall back on, unlike emoji mode,
    // which always has the stock unicode categories - a room with no own sticker packs and no
    // favorited ones would otherwise render a totally blank body). onFinished closes the picker,
    // since this is navigating away to Settings rather than picking anything.
    private onOpenSettings = (): void => {
        this.props.onFinished();
        dis.dispatch({
            action: Action.ViewUserSettings,
            initialTabId: UserTab.EmojiStickers,
        });
    };

    // Haven: opens Room Settings' own Emoji & Stickers tab for `roomId` - used by a manageable
    // pack category's gear icon, and by the "this room has no packs yet" placeholder's create
    // link. `stateKey`, when given (the gear's own case - there's no existing pack to open yet
    // from the create-placeholder's link), queues that exact pack's own editor to open
    // automatically once the tab mounts, the same as clicking "View" on it from that tab directly
    // - see utils/pendingManagePack.ts.
    private onManageClick = (roomId: string, stateKey?: string): void => {
        this.props.onFinished();
        // A pack's own state_key is very commonly "" (MSC2545 doesn't give it any meaning beyond
        // being a slot - see ImagePacks.ts's own doc) - a truthy check here would silently skip
        // queuing it for exactly that common case, indistinguishable from "no stateKey was passed
        // at all" (the create-placeholder's own call site, which really does mean that).
        if (stateKey !== undefined) setPendingManagePackStateKey(stateKey);
        dis.dispatch({
            action: "open_room_settings",
            room_id: roomId,
            initial_tab_id: RoomSettingsTab.EmojiStickers,
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
                            ref={this.rootRef as React.RefObject<HTMLElement>}
                        >
                            <Header
                                categories={this.categories}
                                onAnchorClick={this.scrollToCategory}
                                onOpenSettings={this.onOpenSettings}
                            />
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
                                                    <AccessibleButton kind="link_inline" onClick={this.onOpenSettings}>
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
                                            if (category.isCreatePlaceholder) {
                                                const categoryElement = (
                                                    <section
                                                        key={category.id}
                                                        id={`mx_EmojiPicker_category_${category.id}`}
                                                        className="mx_EmojiPicker_category mx_EmojiPicker_createPackCategory"
                                                        data-category-id={category.id}
                                                        role="tabpanel"
                                                        aria-label={category.name}
                                                    >
                                                        <h2 className="mx_EmojiPicker_category_label">
                                                            {category.name}
                                                        </h2>
                                                        <div className="mx_EmojiPicker_createPackCategory_body">
                                                            {_t(
                                                                "emoji_picker|create_pack_prompt",
                                                                {},
                                                                {
                                                                    a: (sub) => (
                                                                        <AccessibleButton
                                                                            kind="link_inline"
                                                                            onClick={() =>
                                                                                this.onManageClick(
                                                                                    this.props.room!.roomId,
                                                                                )
                                                                            }
                                                                        >
                                                                            {sub}
                                                                        </AccessibleButton>
                                                                    ),
                                                                },
                                                            )}
                                                        </div>
                                                    </section>
                                                );
                                                heightBefore += CREATE_PACK_PLACEHOLDER_HEIGHT;
                                                return categoryElement;
                                            }

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
                                                    onManageClick={
                                                        category.manageRoomId
                                                            ? () =>
                                                                  this.onManageClick(
                                                                      category.manageRoomId!,
                                                                      category.manageStateKey,
                                                                  )
                                                            : undefined
                                                    }
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

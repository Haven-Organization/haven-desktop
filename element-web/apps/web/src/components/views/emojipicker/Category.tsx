/*
Copyright 2024 New Vector Ltd.
Copyright 2020 The Matrix.org Foundation C.I.C.
Copyright 2019 Tulir Asokan <tulir@maunium.net>

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, type RefObject } from "react";
import classNames from "classnames";
import { type Emoji as IEmoji } from "@matrix-org/emojibase-bindings";

import { CATEGORY_HEADER_HEIGHT, EMOJI_HEIGHT, EMOJIS_PER_ROW, STICKERS_PER_ROW } from "./config";
import LazyRenderList from "../elements/LazyRenderList";
import Emoji from "./Emoji";
import { isCustomEmoji } from "./customEmoji";
import { type ButtonEvent } from "../elements/AccessibleButton";

const OVERFLOW_ROWS = 3;

// Widened from `keyof typeof DATA_BY_CATEGORY | "recent"` to a plain string - a Haven image pack's
// own synthetic category id (e.g. `pack-!roomId-stateKey`) isn't one of emojibase's own fixed
// category keys, and there's no fixed enumeration of how many packs might exist.
export type CategoryKey = string;

export interface ICategory {
    id: CategoryKey;
    name: string;
    // Emoji to show in the header for this category - ignored (rail shows iconUrl instead) when
    // iconUrl is set.
    emoji: string;
    /** Haven: an MSC2545 pack's own avatar (mxc://...) - shown in the rail instead of `emoji` when
     *  present, identifying this as a pack's own category rather than a real emojibase one. */
    iconUrl?: string;
    enabled: boolean;
    // Whether the category is currently visible
    visible: boolean;
    // Whether the category is the first visible category
    firstVisible: boolean;
    ref: RefObject<HTMLButtonElement | null>;
}

interface IProps {
    id: string;
    name: string;
    emojis: IEmoji[];
    selectedEmojis?: Set<string>;
    heightBefore: number;
    viewportHeight: number;
    scrollTop: number;
    onClick(ev: ButtonEvent, emoji: IEmoji): void;
    onMouseEnter(emoji: IEmoji): void;
    onMouseLeave(emoji: IEmoji): void;
    isEmojiDisabled?: (unicode: string) => boolean;
    isFreeformEmoji?: (unicode: string) => boolean;
    /** Haven: how many grid cells make up one row, and how tall each row is - defaults to the
     *  stock emoji grid's own EMOJIS_PER_ROW/EMOJI_HEIGHT if omitted. EmojiPicker's own sticker
     *  mode passes bigger values (see its own STICKERS_PER_ROW/STICKER_HEIGHT doc) so stickers get
     *  a visibly bigger slot than emoji - these two numbers must stay in lockstep with each other
     *  and with the CSS driving mx_EmojiPicker_item_wrapper's actual rendered size, since this
     *  class's own row virtualization math depends on the row height it's told matching what
     *  really gets rendered. */
    itemsPerRow?: number;
    itemHeight?: number;
}

function hexEncode(str: string): string {
    let hex: string;
    let i: number;

    let result = "";
    for (i = 0; i < str.length; i++) {
        hex = str.charCodeAt(i).toString(16);
        result += ("000" + hex).slice(-4);
    }

    return result;
}

class Category extends React.PureComponent<IProps> {
    private renderEmojiRow = (rowIndex: number): JSX.Element => {
        const { onClick, onMouseEnter, onMouseLeave, selectedEmojis, emojis, itemsPerRow = EMOJIS_PER_ROW } =
            this.props;
        const emojisForRow = emojis.slice(rowIndex * itemsPerRow, (rowIndex + 1) * itemsPerRow);
        const wrapperClassName = classNames("mx_EmojiPicker_item_wrapper", {
            mx_EmojiPicker_item_wrapper_sticker: itemsPerRow === STICKERS_PER_ROW,
        });
        return (
            <div key={rowIndex} role="row">
                {emojisForRow.map((emoji) => (
                    <div role="gridcell" className={wrapperClassName} key={emoji.hexcode}>
                        <Emoji
                            emoji={emoji}
                            selectedEmojis={selectedEmojis}
                            onClick={onClick}
                            onMouseEnter={onMouseEnter}
                            onMouseLeave={onMouseLeave}
                            disabled={this.props.isEmojiDisabled?.(isCustomEmoji(emoji) ? emoji.mxcUrl : emoji.unicode)}
                            className={this.props.isFreeformEmoji?.(emoji.unicode) ? "mx_EmojiPicker_item_freeform" : undefined}
                            id={`mx_EmojiPicker_item_${this.props.id}_${hexEncode(emoji.unicode)}`}
                        />
                    </div>
                ))}
            </div>
        );
    };

    public render(): React.ReactNode {
        const { emojis, name, heightBefore, viewportHeight, scrollTop, itemsPerRow = EMOJIS_PER_ROW, itemHeight = EMOJI_HEIGHT } = this.props;
        if (!emojis || emojis.length === 0) {
            return null;
        }
        const rows = new Array(Math.ceil(emojis.length / itemsPerRow));
        for (let counter = 0; counter < rows.length; ++counter) {
            rows[counter] = counter;
        }

        const viewportTop = scrollTop;
        const viewportBottom = viewportTop + viewportHeight;
        const listTop = heightBefore + CATEGORY_HEADER_HEIGHT;
        const listBottom = listTop + rows.length * itemHeight;
        const top = Math.max(viewportTop, listTop);
        const bottom = Math.min(viewportBottom, listBottom);
        // the viewport height and scrollTop passed to the LazyRenderList
        // is capped at the intersection with the real viewport, so lists
        // out of view are passed height 0, so they won't render any items.
        const localHeight = Math.max(0, bottom - top);
        const localScrollTop = Math.max(0, scrollTop - listTop);

        return (
            <section
                id={`mx_EmojiPicker_category_${this.props.id}`}
                className="mx_EmojiPicker_category"
                data-category-id={this.props.id}
                role="tabpanel"
                aria-label={name}
            >
                <h2 className="mx_EmojiPicker_category_label">{name}</h2>
                <LazyRenderList
                    className="mx_EmojiPicker_list"
                    itemHeight={itemHeight}
                    items={rows}
                    scrollTop={localScrollTop}
                    height={localHeight}
                    overflowItems={OVERFLOW_ROWS}
                    overflowMargin={0}
                    renderItem={this.renderEmojiRow}
                    role="grid"
                    aria-multiselectable
                />
            </section>
        );
    }
}

export default Category;

/*
Copyright 2024 New Vector Ltd.
Copyright 2020 The Matrix.org Foundation C.I.C.
Copyright 2019 Tulir Asokan <tulir@maunium.net>

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import { type MatrixEvent, EventType, RelationType, type Relations, RelationsEvent } from "matrix-js-sdk/src/matrix";

import { type CustomEmojiChoice } from "./customEmoji";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import RoomContext from "../../../contexts/RoomContext";
import { type FocusComposerPayload } from "../../../dispatcher/payloads/FocusComposerPayload";
import { REACTION_SHORTCODE_KEY } from "../../../viewmodels/room/timeline/event-tile/reactions/reactionShortcode";
import { IMAGE_SOURCE_PACKS_KEY, buildImageSourcePacks } from "../../../utils/imageSourcePacks";
import { HavenEmojiPicker } from "../../../emojipicker/HavenEmojiPicker";
import { EmojiPickerWithRecents } from "../../../emojipicker/EmojiPickerWithRecents";
import * as recent from "../../../emojipicker/recent";
import SettingsStore from "../../../settings/SettingsStore";
import AccessibleButton from "../elements/AccessibleButton";
import { _t } from "../../../languageHandler";

interface IProps {
    mxEvent: MatrixEvent;
    reactions?: Relations | null | undefined;
    onFinished(): void;
    /** Haven: called after a new reaction is actually sent (not on removal/redaction) — lets a
     *  caller treat any emoji reaction, not just its own app-specific ones, as an interaction with
     *  the target event (e.g. Social's "mark read on any m.reaction" behavior). */
    onReact?(): void;
}

interface IState {
    selectedEmojis: Set<string>;
    /** Haven: the stock-picker branch's own copy of HavenEmojiPicker's identical `filter` state -
     *  see this component's own onClickFreeformReact for why the stock branch needs its own. */
    filter: string;
}

class ReactionPicker extends React.Component<IProps, IState> {
    public static contextType = RoomContext;
    declare public context: React.ContextType<typeof RoomContext>;

    public constructor(props: IProps) {
        super(props);

        this.state = {
            selectedEmojis: new Set(Object.keys(this.getReactions())),
            filter: "",
        };
    }

    public componentDidMount(): void {
        this.addListeners();
    }

    public componentDidUpdate(prevProps: IProps): void {
        if (prevProps.reactions !== this.props.reactions) {
            this.addListeners();
            this.onReactionsChange();
        }
    }

    private addListeners(): void {
        if (this.props.reactions) {
            this.props.reactions.on(RelationsEvent.Add, this.onReactionsChange);
            this.props.reactions.on(RelationsEvent.Remove, this.onReactionsChange);
            this.props.reactions.on(RelationsEvent.Redaction, this.onReactionsChange);
        }
    }

    public componentWillUnmount(): void {
        if (this.props.reactions) {
            this.props.reactions.removeListener(RelationsEvent.Add, this.onReactionsChange);
            this.props.reactions.removeListener(RelationsEvent.Remove, this.onReactionsChange);
            this.props.reactions.removeListener(RelationsEvent.Redaction, this.onReactionsChange);
        }
    }

    private getReactions(): Record<string, string> {
        if (!this.props.reactions) {
            return {};
        }
        const userId = MatrixClientPeg.safeGet().getSafeUserId();
        const myAnnotations = this.props.reactions.getAnnotationsBySender()?.[userId] ?? new Set<MatrixEvent>();
        return Object.fromEntries(
            [...myAnnotations]
                .filter((event) => !event.isRedacted())
                .map((event) => [event.getRelation()?.key, event.getId()]),
        );
    }

    private onReactionsChange = (): void => {
        this.setState({
            selectedEmojis: new Set(Object.keys(this.getReactions())),
        });
    };

    private onChoose = (reaction: string, custom?: CustomEmojiChoice): boolean => {
        this.componentWillUnmount();
        this.props.onFinished();
        // Haven: a custom emoji reaction's `key` is its mxc:// URL, not its shortcode text - this
        // is the same convention MSC4459/MSC4027 use and that ReactionsRowButtonViewModel.ts (see
        // its own `content.startsWith("mxc://")` check) already expects on the *render* side. The
        // human-readable shortcode still travels along for tooltips/aria-labels, under
        // REACTION_SHORTCODE_KEY (com.beeper.reaction.shortcode).
        const key = custom ? custom.mxcUrl : reaction;
        const myReactions = this.getReactions();
        if (myReactions.hasOwnProperty(key)) {
            if (this.props.mxEvent.isRedacted() || !this.context.canSelfRedact) return false;

            void MatrixClientPeg.safeGet().redactEvent(this.props.mxEvent.getRoomId()!, myReactions[key]);
            dis.dispatch<FocusComposerPayload>({
                action: Action.FocusAComposer,
                context: this.context.timelineRenderingType,
            });
            // Tell the emoji picker not to bump this in the more frequently used list.
            return false;
        } else {
            const client = MatrixClientPeg.safeGet();
            // Haven: MSC4459 provenance (optional per the MSC's own MSC4027-reactions bullet) - the
            // pack's own source room may differ from whatever room this reaction is being sent in
            // (a favorited pack can live anywhere), so it's resolved fresh off custom.roomId rather
            // than assumed to be this.context.room.
            const sourceRoom = custom ? client.getRoom(custom.roomId) : undefined;
            const imageSourcePacks =
                custom && sourceRoom
                    ? buildImageSourcePacks(custom.mxcUrl, sourceRoom, custom.stateKey, custom.shortcode)
                    : {};
            const content = {
                "m.relates_to": {
                    rel_type: RelationType.Annotation,
                    event_id: this.props.mxEvent.getId()!,
                    key,
                },
                ...(custom ? { [REACTION_SHORTCODE_KEY.name]: `:${custom.shortcode}:` } : {}),
                ...(Object.keys(imageSourcePacks).length > 0 ? { [IMAGE_SOURCE_PACKS_KEY]: imageSourcePacks } : {}),
            };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            void client.sendEvent(this.props.mxEvent.getRoomId()!, EventType.Reaction, content as any);
            this.props.onReact?.();
            dis.dispatch({ action: "message_sent" });
            dis.dispatch<FocusComposerPayload>({
                action: Action.FocusAComposer,
                context: this.context.timelineRenderingType,
            });
            return true;
        }
    };

    private isEmojiDisabled = (unicode: string): boolean => {
        if (!this.getReactions()[unicode]) return false;
        if (this.context.canSelfRedact) return false;

        return true;
    };

    // Haven: EmojiPickerWithRecents (unlike HavenEmojiPicker) always calls its own onChoose with
    // the picked item's own PickerEmoji as the second argument, even for a plain unicode pick -
    // never a CustomEmojiChoice, since this picker has no pack data to produce one from at all.
    // this.onChoose expects a CustomEmojiChoice there and reads custom.mxcUrl off it, so forwarding
    // that PickerEmoji through unchanged would read undefined off the wrong shape instead of
    // reliably falling through to the plain-reaction branch - dropping the second argument entirely
    // here is what actually gets that fallback right.
    private onChoosePlain = (reaction: string): boolean => this.onChoose(reaction);

    private onFilterChange = (filter: string): void => {
        this.setState({ filter });
    };

    // Haven: the stock branch's own equivalent of HavenEmojiPicker's identical onClickFreeformReact
    // - that one isn't reachable here since the stock branch never mounts HavenEmojiPicker at all
    // (see EmojiPickerWithRecents.tsx's own doc), so freeform-text reactions need this small amount
    // of duplicated logic to survive Haven.disableCustomEmojiPicker rather than being silently lost.
    private onClickFreeformReact = (): void => {
        const text = this.state.filter.trim();
        if (!text) return;
        if (this.onChoosePlain(text) !== false) recent.add(text);
        this.props.onFinished();
    };

    public render(): React.ReactNode {
        // Haven: see Settings.tsx's own doc for Haven.disableCustomEmojiPicker - drops straight to
        // the plain stock picker (no packs) when set, but keeps freeform-text reactions (see
        // onClickFreeformReact above) - those aren't pack-related, so there's no reason to lose them.
        if (SettingsStore.getValue("Haven.disableCustomEmojiPicker")) {
            return (
                <EmojiPickerWithRecents
                    onChoose={this.onChoosePlain}
                    isEmojiDisabled={this.isEmojiDisabled}
                    onFinished={this.props.onFinished}
                    selectedEmojis={this.state.selectedEmojis}
                    onFilterChange={this.onFilterChange}
                    belowSearch={
                        this.state.filter.trim() && (
                            <AccessibleButton
                                kind="link"
                                className="mx_HavenEmojiPicker_freeformReact"
                                onClick={this.onClickFreeformReact}
                            >
                                {_t("emoji_picker|react_with_text", { text: this.state.filter.trim() })}
                            </AccessibleButton>
                        )
                    }
                />
            );
        }
        // Haven: no `mode` passed - reactions are always the plain "emoji" mode (stock unicode +
        // any emoji/both image packs), never "sticker" - a sticker can't be sent as m.reaction at
        // all (see EmojiPicker's own IProps.mode doc), so ReactionPicker never even offers it.
        const room = MatrixClientPeg.safeGet().getRoom(this.props.mxEvent.getRoomId());
        return (
            <HavenEmojiPicker
                onChoose={this.onChoose}
                isEmojiDisabled={this.isEmojiDisabled}
                onFinished={this.props.onFinished}
                selectedEmojis={this.state.selectedEmojis}
                allowFreeformReaction
                room={room ?? undefined}
            />
        );
    }
}

export default ReactionPicker;

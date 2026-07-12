/*
 * Social Overlay — PillMultiInput
 *
 * A comma-separated, pill-based multi-value text input used by the Feed filter dialog. Values can
 * be typed or pasted (split on commas) or, when an autocomplete provider is supplied, picked from
 * the exact stock room/user autocomplete (RoomProvider/UserProvider — the same provider classes and
 * PillCompletion rows the real message composer uses for `#`/`@`), by clicking a suggestion or
 * pressing Tab to pick the first one.
 */

import React, {
    type JSX,
    type ChangeEvent,
    type ClipboardEvent,
    type KeyboardEvent,
    useCallback,
    useRef,
    useState,
} from "react";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import { CloseIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import AccessibleButton from "../../../../element-web/apps/web/src/components/views/elements/AccessibleButton";
import RoomAvatar from "../../../../element-web/apps/web/src/components/views/avatars/RoomAvatar";
import BaseAvatar from "../../../../element-web/apps/web/src/components/views/avatars/BaseAvatar";
import { useMatrixClientContext } from "../../../../element-web/apps/web/src/contexts/MatrixClientContext";
import { Key } from "../../../../element-web/apps/web/src/Keyboard";
import { type ICompletion } from "../../../../element-web/apps/web/src/autocomplete/Autocompleter";
import type AutocompleteProvider from "../../../../element-web/apps/web/src/autocomplete/AutocompleteProvider";

export interface FilterPill {
    key: string;
    value: string;
    label: string;
    /** Locked pills (e.g. the always-on "Social Rooms" entry) can't be removed by the user. */
    locked?: boolean;
    /** An explicit icon for a pill that isn't a real room/user resolvePillDisplay could look up
     *  (e.g. the locked "Social Rooms" entry, which represents a room *type* filter, not a specific
     *  room) - takes priority over whatever kind-based resolution would otherwise produce. */
    icon?: JSX.Element;
}

interface Props {
    pills: FilterPill[];
    onChange: (pills: FilterPill[]) => void;
    placeholder?: string;
    /** When set, typing the given trigger char shows the stock room/user autocomplete dropdown. */
    autocomplete?: { trigger: "#" | "@"; provider: AutocompleteProvider };
    /** When set, each non-locked pill's avatar/label is resolved live from the client instead of the
     *  static label it was created with - a room's own name (falling back to its ID/alias, the value
     *  stored on the pill) for "room", or a user's displayname (falling back to their MXID) for
     *  "user" - so the display stays correct even for pills typed/pasted as a raw ID rather than
     *  picked from the autocomplete, and updates if the room/user's own name changes later. */
    kind?: "room" | "user";
}

/** Resolves a pill's live avatar/label from the client when possible - undefined avatar means the
 *  room/user isn't locally known at all, in which case there's nothing to show a real avatar for. */
function resolvePillDisplay(
    client: MatrixClient,
    kind: "room" | "user" | undefined,
    pill: FilterPill,
): { label: string; avatar?: JSX.Element } {
    if (pill.locked || !kind) return { label: pill.label };

    if (kind === "room") {
        const room = pill.value.startsWith("!")
            ? client.getRoom(pill.value)
            : (client
                  .getRooms()
                  .find((r) => r.getCanonicalAlias() === pill.value || r.getAltAliases().includes(pill.value)) ??
              null);
        if (!room) return { label: pill.value };
        return { label: room.name || pill.value, avatar: <RoomAvatar room={room} size="20px" /> };
    }

    const user = client.getUser(pill.value);
    if (!user) return { label: pill.value };
    const displayName = user.displayName || pill.value;
    const httpAvatarUrl = user.avatarUrl ? client.mxcUrlToHttp(user.avatarUrl, 20, 20, "crop") : null;
    return {
        label: displayName,
        avatar: <BaseAvatar name={displayName} idName={pill.value} url={httpAvatarUrl ?? undefined} size="20px" />,
    };
}

let nextPillKey = 0;
function makePillKey(): string {
    nextPillKey += 1;
    return `pill-${Date.now()}-${nextPillKey}`;
}

export function PillMultiInput({ pills, onChange, placeholder, autocomplete, kind }: Props): JSX.Element {
    const client = useMatrixClientContext();
    const [draft, setDraft] = useState("");
    const [suggestions, setSuggestions] = useState<ICompletion[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);

    const commitSegments = useCallback(
        (text: string) => {
            const segments = text
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
            if (segments.length === 0) return;
            const newPills = segments.map((value) => ({ key: makePillKey(), value, label: value }));
            onChange([...pills, ...newPills]);
        },
        [pills, onChange],
    );

    const addCompletionPill = useCallback(
        (completion: ICompletion) => {
            const value = completion.completionId ?? completion.completion;
            onChange([...pills, { key: makePillKey(), value, label: completion.completion }]);
            setDraft("");
            setSuggestions([]);
        },
        [pills, onChange],
    );

    const removePill = useCallback(
        (key: string) => {
            onChange(pills.filter((p) => p.key !== key));
        },
        [pills, onChange],
    );

    const updateSuggestions = useCallback(
        async (text: string) => {
            if (!autocomplete || !text.startsWith(autocomplete.trigger)) {
                setSuggestions([]);
                return;
            }
            const matches = await autocomplete.provider.getCompletions(
                text,
                { start: text.length, end: text.length },
                false,
                8,
            );
            setSuggestions(matches);
        },
        [autocomplete],
    );

    const handleChange = (e: ChangeEvent<HTMLInputElement>): void => {
        const value = e.target.value;
        setDraft(value);
        void updateSuggestions(value);
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
        if (e.key === Key.BACKSPACE && !draft && pills.length > 0) {
            const last = pills[pills.length - 1];
            if (!last.locked) removePill(last.key);
            return;
        }
        if (e.key === Key.TAB && suggestions.length > 0) {
            e.preventDefault();
            addCompletionPill(suggestions[0]);
            return;
        }
        if (e.key === Key.ENTER || e.key === Key.COMMA) {
            e.preventDefault();
            commitSegments(draft);
            setDraft("");
            setSuggestions([]);
        }
    };

    const handlePaste = (e: ClipboardEvent<HTMLInputElement>): void => {
        const text = e.clipboardData.getData("text");
        if (!text.includes(",")) return; // single value — let it land in the input normally
        e.preventDefault();
        commitSegments(text);
    };

    const handleBlur = (): void => {
        if (draft.trim()) commitSegments(draft);
        setDraft("");
        setSuggestions([]);
    };

    return (
        <div className="social_PillMultiInput">
            <div className="social_PillMultiInput_box">
                <div className="social_PillMultiInput_inputRow">
                    <input
                        ref={inputRef}
                        type="text"
                        className="social_PillMultiInput_input"
                        value={draft}
                        onChange={handleChange}
                        onKeyDown={handleKeyDown}
                        onPaste={handlePaste}
                        onBlur={handleBlur}
                        placeholder={placeholder}
                        autoComplete="off"
                    />
                    {suggestions.length > 0 && (
                        <div className="social_PillMultiInput_suggestions">
                            {suggestions.map((s) => (
                                <div
                                    key={s.completionId ?? s.completion}
                                    className="social_PillMultiInput_suggestion"
                                    // onMouseDown (not onClick) so the input doesn't blur/lose focus first.
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        addCompletionPill(s);
                                    }}
                                >
                                    {s.component}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                {pills.length > 0 && (
                    <div className="social_PillMultiInput_pillGrid">
                        {pills.map((pill) => {
                            const { label, avatar } = resolvePillDisplay(client, kind, pill);
                            const pillIcon = pill.icon ?? avatar;
                            return (
                                <span key={pill.key} className="social_PillMultiInput_pill">
                                    {pillIcon && <span className="social_PillMultiInput_pill_avatar">{pillIcon}</span>}
                                    <span className="social_PillMultiInput_pill_label">{label}</span>
                                    {!pill.locked && (
                                        <AccessibleButton
                                            className="social_PillMultiInput_pill_remove"
                                            onClick={() => removePill(pill.key)}
                                            aria-label={`Remove ${label}`}
                                        >
                                            <CloseIcon width="14px" height="14px" />
                                        </AccessibleButton>
                                    )}
                                </span>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

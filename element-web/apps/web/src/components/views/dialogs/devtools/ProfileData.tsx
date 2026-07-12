/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { useContext, useRef, useState } from "react";
import { Method } from "matrix-js-sdk/src/matrix";

import { _t, _td } from "../../../../languageHandler";
import MatrixClientContext from "../../../../contexts/MatrixClientContext";
import BaseTool, { type IDevtoolsProps } from "./BaseTool";
import SyntaxHighlight from "../../elements/SyntaxHighlight";
import Field from "../../elements/Field";
import Spinner from "../../elements/Spinner";
import { useAsyncMemo } from "../../../../hooks/useAsyncMemo";
import { stringify, validateEventContent } from "./Event";

const ProfileDataEditor: React.FC<{
    profile: Record<string, unknown>;
    onBack(this: void): void;
}> = ({ profile, onBack }) => {
    const cli = useContext(MatrixClientContext);
    const [content, setContent] = useState<string>(stringify(profile));
    const contentField = useRef<Field>(null);

    const onAction = async (): Promise<string | undefined> => {
        const valid = contentField.current ? await contentField.current.validate({}) : false;
        if (!valid) {
            contentField.current?.focus();
            contentField.current?.validate({ focused: true });
            return;
        }

        try {
            const json = JSON.parse(content) as Record<string, unknown>;
            // No bulk "set the whole profile" endpoint exists (MSC4133 fields are set one at a
            // time) — PUT every key present in the edited JSON, and DELETE any key that was in
            // the original profile but is missing from the edited JSON, so this is a real
            // full-replace edit rather than a merge. Devtools is for exactly this kind of thing —
            // if you remove a key and hit Send, it's gone.
            const userId = cli.getSafeUserId();
            for (const [key, value] of Object.entries(json)) {
                await cli.setProfileInfo(key as "displayname", { [key]: value } as { displayname: string });
            }
            for (const key of Object.keys(profile)) {
                if (key in json) continue;
                await cli.http.authedRequest(Method.Delete, `/profile/${encodeURIComponent(userId)}/${encodeURIComponent(key)}`);
            }
        } catch (e) {
            return _t("devtools|failed_to_send") + (e instanceof Error ? ` (${e.message})` : "");
        }
        return _t("devtools|event_sent");
    };

    return (
        <BaseTool actionLabel={_td("forward|send_label")} onAction={onAction} onBack={onBack}>
            <Field
                id="profileContent"
                label={_t("devtools|event_content")}
                type="text"
                className="mx_DevTools_textarea"
                autoComplete="off"
                value={content}
                onChange={(ev) => setContent(ev.target.value)}
                element="textarea"
                onValidate={validateEventContent}
                ref={contentField}
                autoFocus
            />
        </BaseTool>
    );
};

export const ProfileDataExplorer: React.FC<IDevtoolsProps> = ({ onBack }) => {
    const cli = useContext(MatrixClientContext);
    const userId = cli.getSafeUserId();
    // Bumped when returning from the editor so useAsyncMemo re-fetches — otherwise this view (and
    // a subsequent Edit's prefilled content) kept showing whatever was fetched on first mount, even
    // after a successful Send actually changed the profile.
    const [refreshKey, setRefreshKey] = useState(0);
    const profile = useAsyncMemo<Record<string, unknown> | null>(
        () => cli.getProfileInfo(userId),
        [cli, userId, refreshKey],
        null,
    );
    const [editing, setEditing] = useState(false);

    if (!profile) {
        return (
            <BaseTool onBack={onBack}>
                <Spinner />
            </BaseTool>
        );
    }

    if (editing) {
        const onEditorBack = (): void => {
            setEditing(false);
            setRefreshKey((k) => k + 1);
        };
        return <ProfileDataEditor profile={profile} onBack={onEditorBack} />;
    }

    const onAction = async (): Promise<void> => {
        setEditing(true);
    };

    return (
        <BaseTool onBack={onBack} actionLabel={_td("action|edit")} onAction={onAction}>
            <SyntaxHighlight language="json">{stringify(profile)}</SyntaxHighlight>
        </BaseTool>
    );
};

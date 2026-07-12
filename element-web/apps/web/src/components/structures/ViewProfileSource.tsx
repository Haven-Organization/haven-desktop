/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useEffect, useState } from "react";

import SyntaxHighlight from "../views/elements/SyntaxHighlight";
import { _t } from "../../languageHandler";
import { MatrixClientPeg } from "../../MatrixClientPeg";
import BaseDialog from "../views/dialogs/BaseDialog";
import { stringify } from "../views/dialogs/devtools/Event";
import CopyableText from "../views/elements/CopyableText";
import Spinner from "../views/elements/Spinner";

interface IProps {
    userId: string;
    onFinished(): void;
}

/**
 * A developer-mode-only counterpart to ViewSource, for viewing a user's raw profile (displayname,
 * avatar_url, and any other MSC4133-style extensible profile fields) rather than an event's
 * content — same dialog chrome, but the copyable header identifies a user rather than a room+event.
 */
export default function ViewProfileSource({ userId, onFinished }: IProps): JSX.Element {
    const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        MatrixClientPeg.safeGet()
            .getProfileInfo(userId)
            .then((info) => {
                if (!cancelled) setProfile(info as unknown as Record<string, unknown>);
            })
            .catch((err: unknown) => {
                if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load profile");
            });
        return () => {
            cancelled = true;
        };
    }, [userId]);

    const copyProfileFunc = (): string => stringify(profile ?? {});

    return (
        <BaseDialog className="mx_ViewSource" onFinished={onFinished} title={_t("action|view_source")}>
            <div className="mx_ViewSource_header">
                <CopyableText getTextToCopy={() => userId} border={false}>
                    {_t("devtools|user_id", { userId })}
                </CopyableText>
            </div>
            {error ? (
                <div>{error}</div>
            ) : profile ? (
                <>
                    <div className="mx_ViewSource_heading">{_t("devtools|profile_source")}</div>
                    <CopyableText getTextToCopy={copyProfileFunc}>
                        <SyntaxHighlight language="json">{stringify(profile)}</SyntaxHighlight>
                    </CopyableText>
                </>
            ) : (
                <Spinner />
            )}
        </BaseDialog>
    );
}

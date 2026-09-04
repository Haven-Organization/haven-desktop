/*
Copyright 2017-2024 New Vector Ltd.
Copyright 2015, 2016 OpenMarket Ltd

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import classNames from "classnames";

import { _t } from "../../../languageHandler";
import BaseDialog from "./BaseDialog";
import DialogButtons from "../elements/DialogButtons";

export interface IQuestionDialogProps {
    title?: string;
    description?: React.ReactNode;
    extraButtons?: React.ReactNode;
    button?: string;
    buttonDisabled?: boolean;
    danger?: boolean;
    focus?: boolean;
    headerImage?: string;
    quitOnly?: boolean; // quitOnly doesn't show the cancel button just the quit [x].
    fixedWidth?: boolean;
    className?: string;
    hasCancelButton?: boolean;
    cancelButton?: React.ReactNode;
    /**
     * Haven: the CSS class for the cancel button, mirroring `danger`'s effect on the primary
     * button above - lets a caller put a destructive action (e.g. "Discard Changes") in the
     * cancel slot, which renders to the primary button's left, while keeping a non-destructive
     * action as the emphasized primary button. Passed straight through to DialogButtons.
     */
    cancelButtonClass?: string;
    onFinished(ok?: boolean): void;
}

export default class QuestionDialog extends React.Component<IQuestionDialogProps> {
    public static defaultProps: Partial<IQuestionDialogProps> = {
        title: "",
        description: "",
        extraButtons: null,
        focus: true,
        hasCancelButton: true,
        danger: false,
        quitOnly: false,
    };

    private onOk = (): void => {
        this.props.onFinished(true);
    };

    private onCancel = (): void => {
        this.props.onFinished(false);
    };

    public render(): React.ReactNode {
        let primaryButtonClass = "";
        if (this.props.danger) {
            primaryButtonClass = "danger";
        }
        return (
            <BaseDialog
                className={classNames("mx_QuestionDialog", this.props.className)}
                onFinished={this.props.onFinished}
                title={this.props.title}
                contentId="mx_Dialog_content"
                headerImage={this.props.headerImage}
                hasCancel={this.props.hasCancelButton}
                fixedWidth={this.props.fixedWidth}
            >
                <div className="mx_Dialog_content" id="mx_Dialog_content">
                    {this.props.description}
                </div>
                <DialogButtons
                    primaryButton={this.props.button || _t("action|ok")}
                    primaryButtonClass={primaryButtonClass}
                    primaryDisabled={this.props.buttonDisabled}
                    cancelButton={this.props.cancelButton}
                    cancelButtonClass={this.props.cancelButtonClass}
                    hasCancel={this.props.hasCancelButton && !this.props.quitOnly}
                    onPrimaryButtonClick={this.onOk}
                    focus={this.props.focus}
                    onCancel={this.onCancel}
                >
                    {this.props.extraButtons}
                </DialogButtons>
            </BaseDialog>
        );
    }
}

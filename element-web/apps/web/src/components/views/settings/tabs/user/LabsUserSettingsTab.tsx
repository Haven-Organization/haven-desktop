/*
Copyright 2019-2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import { sortBy } from "lodash";
import { type EmptyObject } from "matrix-js-sdk/src/matrix";
import { Form } from "@vector-im/compound-web";

import { _t } from "../../../../../languageHandler";
import SettingsStore from "../../../../../settings/SettingsStore";
import { SettingLevel } from "../../../../../settings/SettingLevel";
import SdkConfig from "../../../../../SdkConfig";
import BetaCard from "../../../beta/BetaCard";
import SettingsFlag from "../../../elements/SettingsFlag";
import { type FeatureSettingKey, type LabGroup, labGroupNames } from "../../../../../settings/Settings";
import { EnhancedMap } from "../../../../../utils/maps";
import { SettingsSection } from "../../shared/SettingsSection";
import { SettingsSubsection, SettingsSubsectionText } from "../../shared/SettingsSubsection";
import SettingsTab from "../SettingsTab";

export const showLabsFlags = (): boolean => {
    return SdkConfig.get("show_labs_settings") || SettingsStore.getValue("developerMode");
};

export default class LabsUserSettingsTab extends React.Component<EmptyObject> {
    private readonly labs: FeatureSettingKey[];
    private readonly betas: FeatureSettingKey[];

    public constructor(props: EmptyObject) {
        super(props);

        // haven: feature_msc4501_native_post_type is a host-only opt-in (set via config.json's
        // "features" block, still fully honored by ConfigSettingsHandler) rather than a normal
        // end-user Labs toggle - Social's own MSC, not something to expose for casual flipping
        // regardless of whether Social itself is enabled in this build.
        const features = SettingsStore.getFeatureSettingNames().filter(
            (f) => f !== "feature_msc4501_native_post_type",
        );
        const [labs, betas] = features.reduce(
            (arr, f) => {
                arr[SettingsStore.getBetaInfo(f) ? 1 : 0].push(f as FeatureSettingKey);
                return arr;
            },
            [[], []] as [FeatureSettingKey[], FeatureSettingKey[]],
        );

        this.labs = labs;
        this.betas = betas;

        if (!showLabsFlags()) {
            this.labs = [];
        }
    }

    public render(): React.ReactNode {
        let betaSection: JSX.Element | undefined;
        if (this.betas.length) {
            betaSection = (
                <>
                    {this.betas.map((f) => (
                        <BetaCard key={f} featureId={f} />
                    ))}
                </>
            );
        }

        let labsSections: JSX.Element | undefined;
        if (this.labs.length) {
            const groups = new EnhancedMap<LabGroup, JSX.Element[]>();
            this.labs.forEach((f) => {
                groups
                    .getOrCreate(SettingsStore.getLabGroup(f)!, [])
                    .push(<SettingsFlag level={SettingLevel.DEVICE} name={f} key={f} />);
            });

            labsSections = (
                <>
                    {sortBy(Array.from(groups.entries()), "0").map(([group, flags]) => (
                        <SettingsSubsection
                            key={group}
                            data-testid={`labs-group-${group}`}
                            heading={_t(labGroupNames[group])}
                        >
                            {flags}
                        </SettingsSubsection>
                    ))}
                </>
            );
        }

        return (
            <SettingsTab>
                <Form.Root
                    onSubmit={(evt) => {
                        evt.preventDefault();
                        evt.stopPropagation();
                    }}
                >
                    <SettingsSection heading={_t("labs|beta_section")}>
                        <SettingsSubsectionText>
                            {_t("labs|beta_description", { brand: SdkConfig.get("brand") })}
                        </SettingsSubsectionText>
                        {betaSection}
                    </SettingsSection>

                    {labsSections && (
                        <SettingsSection heading={_t("labs|experimental_section")}>
                            <SettingsSubsectionText>
                                {_t(
                                    "labs|experimental_description",
                                    {},
                                    {
                                        a: (sub) => {
                                            return (
                                                <a
                                                    href="https://github.com/vector-im/element-web/blob/develop/docs/labs.md"
                                                    rel="noreferrer noopener"
                                                    target="_blank"
                                                >
                                                    {sub}
                                                </a>
                                            );
                                        },
                                    },
                                )}
                            </SettingsSubsectionText>
                            {labsSections}
                        </SettingsSection>
                    )}
                </Form.Root>
            </SettingsTab>
        );
    }
}

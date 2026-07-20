/*
Copyright 2025 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { type JsonObject } from "shared-types";

import { loadJsonFile } from "./utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let buildConfig: BuildConfig;

interface BuildConfig {
    // Application User Model ID
    appId: string;
    // Protocol string used for OIDC callbacks
    protocol: string;
    // Subject name of the code signing cert used for Windows packages, if signed
    // used as a basis for the Tray GUID which must be rolled if the certificate changes.
    windowsCertSubjectName: string | undefined;
    // Haven's own full descriptive version string, shown in Help & About in place of the packaged
    // `version` field (which Windows packaging requires to be a strict X.Y.Z) - undefined for
    // builds that didn't set HAVEN_FULL_VERSION (e.g. plain local dev builds).
    havenFullVersion: string | undefined;
}

export function getBuildConfig(): BuildConfig {
    if (!buildConfig) {
        const packageJson = loadJsonFile(path.join(__dirname, "..", "package.json")) as JsonObject;
        buildConfig = {
            appId: (packageJson["electron_appId"] as string) || "im.riot.app",
            protocol: (packageJson["electron_protocol"] as string) || "io.element.desktop",
            windowsCertSubjectName: packageJson["electron_windows_cert_sn"] as string,
            havenFullVersion: packageJson["haven_full_version"] as string,
        };
    }

    return buildConfig;
}

/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { expect, describe, it, beforeEach, vi } from "vitest";
import { fs as memfs, vol } from "memfs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

vi.mock("node:fs", () => ({ default: memfs }));

beforeEach(() => {
    // Reset the state of the in-memory fs
    vol.reset();
    // getBuildConfig() memoizes its result at module scope, so each test needs a fresh module
    // instance to see its own package.json fixture rather than the previous test's cached result.
    vi.resetModules();
});

describe("getBuildConfig", () => {
    it("should read fields from package.json correctly", async () => {
        vol.fromJSON(
            {
                "../package.json": JSON.stringify({
                    electron_appId: "app.id",
                    electron_protocol: "proto",
                    electron_windows_cert_sn: "subject.name",
                    haven_full_version: "haven-v0.4.0+element-v1.12.23-188-gdd7c9ed6fe",
                }),
            },
            __dirname,
        );

        const { getBuildConfig } = await import("./build-config.js");
        const config = getBuildConfig();
        expect(config.appId).toBe("app.id");
        expect(config.protocol).toBe("proto");
        expect(config.windowsCertSubjectName).toBe("subject.name");
        expect(config.havenFullVersion).toBe("haven-v0.4.0+element-v1.12.23-188-gdd7c9ed6fe");
    });

    it("should leave havenFullVersion undefined when not set in package.json", async () => {
        vol.fromJSON(
            {
                "../package.json": JSON.stringify({
                    electron_appId: "app.id",
                    electron_protocol: "proto",
                }),
            },
            __dirname,
        );

        const { getBuildConfig } = await import("./build-config.js");
        const config = getBuildConfig();
        expect(config.havenFullVersion).toBeUndefined();
    });
});

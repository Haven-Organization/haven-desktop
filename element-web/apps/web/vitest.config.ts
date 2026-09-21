/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";
import svgr from "vite-plugin-svgr";
import { playwright } from "@vitest/browser-playwright";
import { env, platform } from "node:process";

import rootConfig from "../../vitest.config.ts";

function resolve(specifier: string): string {
    return fileURLToPath(import.meta.resolve(specifier));
}

// Tests that need a real browser rather than the happy-dom environment used by
// `vitest.config.ts` — currently those which rasterise to a <canvas> and assert
// on the pixels, which needs a real 2D context and real font metrics.

// Screenshot baselines only mean anything where the rendering is pinned: the
// generic `sans-serif` the badges use resolves to a different typeface on each
// OS, so a macOS baseline would never match CI. We therefore only commit linux
// baselines, and only assert against them when running somewhere that renders
// the same way — CI, or the pinned container that `playwright-screenshots`
// starts (it sets PW_TEST_CONNECT_WS_ENDPOINT). Everywhere else the screenshot
// assertions skip; the rest of the suite still runs.
const wsEndpoint = env["PW_TEST_CONNECT_WS_ENDPOINT"];
const canCompareScreenshots = Boolean(wsEndpoint || env["CI"]);
const browserPlatform = canCompareScreenshots ? "linux" : platform;

export default defineProject({
    server: {
        fs: {
            // Haven: without this, Vite's dev-server module loader (used to serve files under the
            // happy-dom environment, unlike plain "node") refuses to serve src/apps/**/*.test.ts
            // files at all ("Cannot find module /@fs/...") - they sit outside apps/web/'s own
            // filesystem boundary, one level above the repo root this config's own __dirname is in.
            // (Not resolve() above - that helper takes a single module specifier, so passing it a
            // second argument silently allowed apps/web itself instead of the repo root.)
            allow: [fileURLToPath(new URL("../../../", import.meta.url))],
        },
    },
    resolve: {
        alias: [
            { find: "test-utils-rtl", replacement: resolve("./src/test/test-utils/vitest-matrix-react") },
            { find: "test-utils", replacement: resolve("./src/test/test-utils") },
            // Stub out workers as they do not play well under test
            {
                find: /.*workers\/(.+)Factory/,
                replacement: resolve("./__mocks__/workerFactoryMock.js"),
            },
            {
                find: /.*waveWorker\.min\.js$/,
                replacement: resolve("./__mocks__/empty.js"),
            },
            {
                find: /.*decoderWorker\.min\.js$/,
                replacement: resolve("./__mocks__/empty.js"),
            },
            {
                find: /.*decoderWorker\.min\.wasm$/,
                replacement: resolve("./__mocks__/empty.js"),
            },
            // Stub this out as we lack AudioWorkletProcessor in the test env
            {
                find: "./recorderWorkletFactory",
                replacement: resolve("./__mocks__/empty.js"),
            },
            // Stub out legacy modules so we don't need to build them first
            {
                find: "../modules.js",
                replacement: resolve("./__mocks__/empty.js"),
            },
            // Haven: mirrors webpack.config.ts's own "legacy-room-list" alias, always resolved to
            // the stub here regardless of HAVEN_INCLUDE_OLD_ROOM_LIST (a build-only env var) - the
            // real ~40-file subsystem already has its own dedicated tests under
            // src/legacy-room-list/**/*.test.*, nothing outside those needs the real thing loaded.
            { find: "legacy-room-list", replacement: resolve("./src/legacy-room-list-stub") },
        ],
    },
    test: {
        coverage: {
            exclude: ["src/**/*.stories.tsx"],
            provider: "v8",
            include: ["src/**/*.{ts,tsx}"],
            reporter: [["lcov", { projectRoot: "../../" }]],
        },
        reporters: rootConfig.test?.reporters,
        globals: false,
        environment: "node",
        pool: "threads",
        projects: [
            {
                extends: true,
                test: {
                    name: "unit",
                    include: [
                        "src/**/*.test.{ts,tsx}",
                        // Haven: src/apps/{framework,social} lives at the outer repo root (a sibling of
                        // element-web/, not inside it). Picked up here rather than as its own vitest project so
                        // it reuses this project's setupFiles/aliases/plugins (test-utils, test-utils-rtl, the
                        // svgr/asset mocks below) instead of duplicating them. Mirrors webpack.config.ts's own
                        // path.resolve(__dirname, "../../..", "src", "apps").
                        "../../../src/apps/**/*.test.{ts,tsx}",
                    ],
                    setupFiles: ["src/test/setupJsdomPolyfills.ts", "src/test/setupTests.ts"],
                    environmentOptions: {
                        happyDOM: {
                            url: "http://localhost/",
                        },
                        jsdom: {
                            url: "http://localhost/",
                        },
                    },
                    snapshotSerializers: [resolve("./src/test/react-use-id-serializer.ts")],
                },
                plugins: [
                    svgr({
                        svgrOptions: {
                            ref: true,
                            svgProps: { "role": "presentation", "aria-hidden": "true" },
                            expandProps: "end",
                        },
                    }),
                ],
            },
            {
                extends: true,
                test: {
                    name: "browser",
                    include: ["src/**/*.test.browser.{ts,tsx}"],
                    browser: {
                        enabled: true,
                        headless: true,
                        viewport: { width: 960, height: 720 },
                        provider: playwright({
                            contextOptions: {
                                reducedMotion: "reduce",
                                colorScheme: "light",
                                deviceScaleFactor: 1,
                                viewport: { width: 960, height: 720 },
                            },
                            launchOptions: {
                                // Force consistent font rendering, as per packages/shared-components
                                args: [
                                    "--font-render-hinting=none",
                                    "--disable-font-subpixel-positioning",
                                    "--disable-lcd-text",
                                ],
                            },
                            connectOptions: wsEndpoint ? { wsEndpoint, exposeNetwork: "<loopback>" } : undefined,
                        }),
                        instances: [{ browser: "chromium" }],
                        expect: {
                            toMatchScreenshot: {
                                comparatorName: "pixelmatch",
                                comparatorOptions: {
                                    // Enough to absorb sub-pixel antialiasing noise, but far less
                                    // than a clipped or misplaced glyph moves.
                                    allowedMismatchedPixelRatio: 0.02,
                                },
                                // Baselines are grouped by platform, and only the linux ones are
                                // committed — see apps/web/.gitignore.
                                resolveScreenshotPath: ({
                                    root,
                                    testFileDirectory,
                                    screenshotDirectory,
                                    testFileName,
                                    arg,
                                    ext,
                                    browserName,
                                }) =>
                                    `${root}/${testFileDirectory}/${screenshotDirectory}/${browserPlatform}/${testFileName}/${arg}-${browserName}${ext}`,
                            },
                        },
                    },
                    provide: { canCompareScreenshots },
                },
            },
        ],
    },
});

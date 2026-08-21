/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";
import svgr from "vite-plugin-svgr";

function resolve(specifier: string): string {
    return fileURLToPath(import.meta.resolve(specifier));
}

export default defineProject({
    server: {
        fs: {
            // Haven: without this, Vite's dev-server module loader (used to serve files under the
            // happy-dom environment, unlike plain "node") refuses to serve src/apps/**/*.test.ts
            // files at all ("Cannot find module /@fs/...") - they sit outside apps/web/'s own
            // filesystem boundary, one level above the repo root this config's own __dirname is in.
            allow: [resolve(__dirname, "../../..")],
        },
    },
    resolve: {
        alias: [
            { find: "test-utils-rtl", replacement: resolve("./test/test-utils/vitest-matrix-react") },
            { find: "test-utils", replacement: resolve("./test/test-utils") },
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
            // test/unit-tests/legacy-room-list/, nothing outside those needs the real thing loaded.
            { find: "legacy-room-list", replacement: resolve("./src/legacy-room-list-stub") },
        ],
    },
    test: {
        include: [
            "src/**/*.test.{ts,tsx}",
            // Haven: src/apps/{framework,social} lives at the outer repo root (a sibling of
            // element-web/, not inside it). Picked up here rather than as its own vitest project so
            // it reuses this project's setupFiles/aliases/plugins (test-utils, test-utils-rtl, the
            // svgr/asset mocks below) instead of duplicating them. Mirrors webpack.config.ts's own
            // path.resolve(__dirname, "../../..", "src", "apps").
            "../../../src/apps/**/*.test.{ts,tsx}",
        ],
        environment: "node",
        pool: "threads",
        globals: false,
        setupFiles: ["src/test/setupTests.ts"],
        environmentOptions: {
            happyDOM: {
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
});

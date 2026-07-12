/*
Copyright 2024 New Vector Ltd.
Copyright 2024 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { logger } from "matrix-js-sdk/src/logger";

import { createAudioContext } from "./compat";

const formatMap = {
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
};

export class BackgroundAudio {
    private audioContext = createAudioContext();
    private sounds: Record<string, AudioBuffer> = {};

    public async pickFormatAndPlay<F extends Array<keyof typeof formatMap>>(
        urlPrefix: string,
        formats: F,
        loop = false,
    ): Promise<AudioBufferSourceNode> {
        const format = this.pickFormat(...formats);
        if (!format) {
            console.log("Browser doesn't support any of the formats", formats);
            // Will probably never happen. If happened, format="" and will fail to load audio. Who cares...
        }

        return this.play(`${urlPrefix}.${format}`, loop);
    }

    /**
     * @param maxDurationSeconds - if given, the sound is cut off after this many seconds instead
     * of playing to the end — used to cap how long a user-uploaded custom notification sound can
     * play for, since (unlike the built-in notification sounds) there's no guarantee it's short.
     */
    public async play(url: string, loop = false, maxDurationSeconds?: number): Promise<AudioBufferSourceNode> {
        if (!this.sounds.hasOwnProperty(url)) {
            // No cache, fetch it
            const response = await fetch(url);
            if (response.status != 200) {
                logger.warn("Failed to fetch error audio");
            }
            const buffer = await response.arrayBuffer();
            const sound = await this.audioContext.decodeAudioData(buffer);
            this.sounds[url] = sound;
        }
        const source = this.audioContext.createBufferSource();
        source.buffer = this.sounds[url];
        source.loop = loop;
        source.connect(this.audioContext.destination);

        await this.audioContext.resume();
        source.onended = () => {
            this.audioContext.suspend();
        };

        source.start();
        if (maxDurationSeconds && maxDurationSeconds > 0) {
            source.stop(this.audioContext.currentTime + maxDurationSeconds);
        }
        return source;
    }

    private pickFormat<F extends Array<keyof typeof formatMap>>(...formats: F): F[number] | null {
        // Detect supported formats
        const audioElement = document.createElement("audio");

        for (const format of formats) {
            if (audioElement.canPlayType(formatMap[format])) {
                return format;
            }
        }
        return null;
    }
}

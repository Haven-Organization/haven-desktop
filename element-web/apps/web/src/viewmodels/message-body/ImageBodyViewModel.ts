/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { type ComponentProps, type MouseEvent, type RefObject } from "react";
import { logger } from "matrix-js-sdk/src/logger";
import { ClientEvent, type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { type ImageContent } from "matrix-js-sdk/src/types";
import {
    BaseViewModel,
    ImageBodyViewPlaceholder,
    ImageBodyViewState,
    type ImageBodyViewModel as ImageBodyViewModelInterface,
    type ImageBodyViewSnapshot,
} from "@element-hq/web-shared-components";

import Modal from "../../Modal";
import { MatrixClientPeg } from "../../MatrixClientPeg";
import { _t } from "../../languageHandler";
import { mediaFromContent } from "../../customisations/Media";
import { TimelineRenderingType } from "../../contexts/RoomContext";
import SettingsStore from "../../settings/SettingsStore";
import { type ImageSize, suggestedSize as suggestedImageSize } from "../../settings/enums/ImageSize";
import { presentableTextForFile } from "../../utils/FileUtils";
import { type MediaEventHelper } from "../../utils/MediaEventHelper";
import { blobIsAnimated, mayBeAnimated } from "../../utils/Image";
import { getHeicDisplayUrl, isHeicMimeType } from "../../utils/HeicImage";
import { type RoomPermalinkCreator } from "../../utils/permalinks/Permalinks";
import { createReconnectedListener } from "../../utils/connection";
import { DecryptError, DownloadError } from "../../utils/DecryptFile";
import { BLURHASH_FIELD, createThumbnail } from "../../utils/image-media";
import { isMimeTypeAllowed } from "../../utils/blobs";
import ImageView from "../../components/views/elements/ImageView";

export interface ImageBodyViewModelProps {
    /**
     * Image event being rendered.
     */
    mxEvent: MatrixEvent;
    /**
     * Helper for resolving encrypted media sources.
     */
    mediaEventHelper?: MediaEventHelper;
    /**
     * Whether the image is being rendered for export instead of the live timeline.
     */
    forExport?: boolean;
    /**
     * Optional maximum height applied when computing the rendered image dimensions.
     */
    maxImageHeight?: number;
    /**
     * Whether the media should currently be shown instead of the hidden-media preview.
     */
    mediaVisible: boolean;
    /**
     * Permalink helper passed to the image lightbox.
     */
    permalinkCreator?: RoomPermalinkCreator;
    /**
     * Timeline context used to decide which labels and supplemental content should be shown.
     */
    timelineRenderingType: TimelineRenderingType;
    /**
     * Ref to the underlying image element used for load dimensions and lightbox animation.
     */
    imageRef: RefObject<HTMLImageElement | null>;
    /**
     * Callback invoked when hidden media is revealed.
     */
    setMediaVisible?: (visible: boolean) => void;
}

interface LoadedImageDimensions {
    naturalWidth: number;
    naturalHeight: number;
}

interface InternalState {
    contentUrl: string | null;
    thumbUrl: string | null;
    isAnimated: boolean;
    error: unknown | null;
    imgError: boolean;
    imgLoaded: boolean;
    loadedImageDimensions?: LoadedImageDimensions;
    placeholder: ImageBodyViewPlaceholder;
    imageSize: ImageSize;
    generatedThumbnailUrl: string | null;
    /** Automatic retries used up since the image was last (re)requested from scratch. */
    retryCount: number;
    /** Bumped for every new attempt at a URL that already failed, see withRetryCacheBust. */
    cacheBust: number;
}

// A remote homeserver's media (e.g. joining a room whose media was posted from a different
// homeserver than this account's own) can transiently fail its very first fetch if the local
// server hasn't federated/cached it yet, and succeed moments later - exactly what "leave the room
// and come back" already fixed by chance, since a fresh mount re-issues the request from scratch
// with no memory of the earlier failure. Retry that same recovery automatically before falling back
// to the error state.
//
// The delays double so the retries span about a minute and a half rather than the nine seconds
// three evenly spaced ones did: media a bridge announces before it has finished uploading it, or a
// connection that drops for a moment, both outlast a few seconds, and every image that arrived in
// that window was left on "Unable to show image" until the page was reloaded.
const IMAGE_LOAD_RETRY_DELAYS_MS = [1500, 3000, 6000, 12_000, 24_000, 48_000];

// Once in the error state the image is still re-checked now and then without touching what is on
// screen (see probeFailedImage), so one that becomes loadable later shows up by itself.
const FAILED_IMAGE_PROBE_INTERVAL_MS = 2 * 60 * 1000;
const MAX_FAILED_IMAGE_PROBES = 15;

type ImageInfoWithAnimationFlag = NonNullable<ImageContent["info"]> & {
    "org.matrix.msc4230.is_animated"?: boolean;
};

/**
 * View model for the image message body, encapsulating media loading, sizing,
 * visibility, animated-image previews, and lightbox interactions.
 */
export class ImageBodyViewModel
    extends BaseViewModel<ImageBodyViewSnapshot, ImageBodyViewModelProps>
    implements ImageBodyViewModelInterface
{
    private state: InternalState;
    private blurhashTimeout?: number;
    private retryTimeout?: number;
    private probeInterval?: number;
    private probeCount = 0;
    private probeImage?: HTMLImageElement;

    private readonly reconnectedListener = createReconnectedListener((): void => {
        if (!this.state.imgError) {
            MatrixClientPeg.get()?.off(ClientEvent.Sync, this.reconnectedListener);
            return;
        }

        this.reloadImage();
    });

    public constructor(props: ImageBodyViewModelProps) {
        const initialState = ImageBodyViewModel.createInitialState(props.mxEvent);
        super(props, ImageBodyViewModel.computeSnapshot(props, initialState));
        this.state = initialState;

        const imageSizeWatcherRef = SettingsStore.watchSetting("Images.size", null, (_s, _r, _l, _nvl, value) => {
            this.setImageSize(value!);
        });
        this.disposables.track(() => SettingsStore.unwatchSetting(imageSizeWatcherRef));
    }

    private static createInitialState(mxEvent: MatrixEvent): InternalState {
        return {
            contentUrl: null,
            thumbUrl: null,
            isAnimated: false,
            error: null,
            imgError: false,
            imgLoaded: false,
            loadedImageDimensions: undefined,
            placeholder: mxEvent.getContent<ImageContent>().info?.[BLURHASH_FIELD]
                ? ImageBodyViewPlaceholder.NONE
                : ImageBodyViewPlaceholder.SPINNER,
            imageSize: SettingsStore.getValue("Images.size") as ImageSize,
            generatedThumbnailUrl: null,
            retryCount: 0,
            cacheBust: 0,
        };
    }

    // Applied to the resolved content/thumbnail URLs once a retry is underway - React (and the
    // underlying <img> element) won't re-issue a network request for an unchanged src string, so
    // busting the URL is what actually makes the browser try again rather than just replaying its
    // memory of the earlier failed fetch.
    //
    // Only for URLs that go over the network: an encrypted image's blob: URL names bytes already in
    // memory, and stops resolving at all with a query string added.
    private static withRetryCacheBust(url: string | null, cacheBust: number): string | null {
        if (!url || cacheBust === 0 || !/^https?:/i.test(url)) return url;
        const separator = url.includes("?") ? "&" : "?";
        return `${url}${separator}haven_retry=${cacheBust}`;
    }

    private static getImageDimensions(
        props: ImageBodyViewModelProps,
        state: InternalState,
    ): Pick<ImageBodyViewSnapshot, "maxWidth" | "maxHeight" | "aspectRatio" | "isSvg"> {
        const content = props.mxEvent.getContent<ImageContent>();
        const info = content.info;
        const naturalWidth = info?.w ?? state.loadedImageDimensions?.naturalWidth;
        const naturalHeight = info?.h ?? state.loadedImageDimensions?.naturalHeight;

        if (!naturalWidth || !naturalHeight) {
            return {
                maxWidth: undefined,
                maxHeight: undefined,
                aspectRatio: undefined,
                isSvg: info?.mimetype === "image/svg+xml",
            };
        }

        const { w: maxWidth, h: maxHeight } = suggestedImageSize(
            state.imageSize,
            { w: naturalWidth, h: naturalHeight },
            props.maxImageHeight,
        );

        return {
            maxWidth,
            maxHeight,
            aspectRatio: `${naturalWidth}/${naturalHeight}`,
            isSvg: info?.mimetype === "image/svg+xml",
        };
    }

    private static computeErrorLabel(error: unknown, imgError: boolean): string {
        if (error instanceof DecryptError) return _t("timeline|m.image|error_decrypting");
        if (error instanceof DownloadError) return _t("timeline|m.image|error_downloading");
        if (imgError || error) return _t("timeline|m.image|error");

        return _t("timeline|m.image|error");
    }

    private static shouldShowBanner(timelineRenderingType: TimelineRenderingType): boolean {
        return ![TimelineRenderingType.ThreadsList, TimelineRenderingType.File].includes(timelineRenderingType);
    }

    private static computeSnapshot(props: ImageBodyViewModelProps, state: InternalState): ImageBodyViewSnapshot {
        const content = props.mxEvent.getContent<ImageContent>();
        const dimensions = ImageBodyViewModel.getImageDimensions(props, state);
        const autoplayGifs = SettingsStore.getValue("autoplayGifs") as boolean;
        const contentUrl = ImageBodyViewModel.withRetryCacheBust(
            ImageBodyViewModel.getContentUrl(props, state),
            state.cacheBust,
        );
        const thumbnailSrc = props.forExport
            ? (contentUrl ?? undefined)
            : state.isAnimated && autoplayGifs
              ? (contentUrl ?? undefined)
              : (ImageBodyViewModel.withRetryCacheBust(state.thumbUrl, state.cacheBust) ?? contentUrl ?? undefined);

        if (state.error || state.imgError) {
            return {
                state: ImageBodyViewState.ERROR,
                errorLabel: ImageBodyViewModel.computeErrorLabel(state.error, state.imgError),
                errorRetryLabel: _t("timeline|m.image|error_retry"),
                ...dimensions,
            };
        }

        if (!props.mediaVisible) {
            return {
                state: ImageBodyViewState.HIDDEN,
                hiddenButtonLabel: _t("timeline|m.image|show_image"),
                ...dimensions,
            };
        }

        return {
            state: ImageBodyViewState.READY,
            alt: content.body,
            src: contentUrl ?? undefined,
            thumbnailSrc,
            showAnimatedContentOnHover: state.isAnimated && !autoplayGifs && !!contentUrl,
            placeholder: !props.forExport && !state.imgLoaded ? state.placeholder : ImageBodyViewPlaceholder.NONE,
            blurhash: content.info?.[BLURHASH_FIELD],
            gifLabel: state.isAnimated && !autoplayGifs ? "GIF" : undefined,
            bannerLabel: ImageBodyViewModel.shouldShowBanner(props.timelineRenderingType)
                ? presentableTextForFile(content, _t("common|image"), true, true)
                : undefined,
            linkUrl: contentUrl ?? undefined,
            linkTarget: props.forExport ? "_blank" : undefined,
            ...dimensions,
        };
    }

    private static getContentUrl(props: ImageBodyViewModelProps, state: InternalState): string | null {
        if (props.forExport) {
            return (
                props.mxEvent.getContent<ImageContent>().url ??
                props.mxEvent.getContent<ImageContent>().file?.url ??
                null
            );
        }

        return state.contentUrl;
    }

    public loadInitialMediaIfVisible(): void {
        if (!this.props.mediaVisible) {
            return;
        }

        this.scheduleBlurhashPlaceholder();
        void this.downloadImage();
    }

    private updateSnapshotFromState(): void {
        this.snapshot.set(ImageBodyViewModel.computeSnapshot(this.props, this.state));
    }

    private resetState(mxEvent: MatrixEvent): void {
        this.clearBlurhashTimeout();
        this.clearRetryTimeout();
        this.stopFailedImageRecovery();
        this.revokeGeneratedThumbnailUrl();
        this.state = ImageBodyViewModel.createInitialState(mxEvent);
    }

    private clearRetryTimeout(): void {
        if (!this.retryTimeout) {
            return;
        }

        clearTimeout(this.retryTimeout);
        this.retryTimeout = undefined;
    }

    /**
     * Starts everything that can bring an image back out of the error state without the user
     * doing anything: a retry when the connection returns, and a quiet re-check every so often
     * and whenever the window is looked at again.
     */
    private startFailedImageRecovery(): void {
        this.stopFailedImageRecovery();
        MatrixClientPeg.safeGet().on(ClientEvent.Sync, this.reconnectedListener);
        window.addEventListener("online", this.reloadImage);
        document.addEventListener("visibilitychange", this.probeFailedImage);
        this.probeCount = 0;
        this.probeInterval = window.setInterval(this.probeFailedImage, FAILED_IMAGE_PROBE_INTERVAL_MS);
    }

    private stopFailedImageRecovery(): void {
        MatrixClientPeg.get()?.off(ClientEvent.Sync, this.reconnectedListener);
        window.removeEventListener("online", this.reloadImage);
        document.removeEventListener("visibilitychange", this.probeFailedImage);
        if (this.probeInterval) {
            clearInterval(this.probeInterval);
            this.probeInterval = undefined;
        }
        if (this.probeImage) {
            this.probeImage.onload = null;
            this.probeImage.onerror = null;
            this.probeImage = undefined;
        }
    }

    /**
     * Re-checks a failed image off screen, and only brings it back once it has actually loaded.
     * Retrying in place instead would swap the short error line for the full-height image box and
     * back again on every attempt that still fails, moving the timeline around each time.
     */
    private probeFailedImage = (): void => {
        if (this.isDisposed || !this.state.imgError || this.probeImage || document.hidden) {
            return;
        }

        if (this.probeCount >= MAX_FAILED_IMAGE_PROBES) {
            if (this.probeInterval) {
                clearInterval(this.probeInterval);
                this.probeInterval = undefined;
            }
            return;
        }

        const cacheBust = this.state.cacheBust + 1;
        const url = ImageBodyViewModel.withRetryCacheBust(this.state.contentUrl, cacheBust);
        if (!url || !/^https?:/i.test(url)) {
            return;
        }

        this.probeCount++;
        // Every probe gets its own URL, for the same reason a retry does.
        this.state = { ...this.state, cacheBust };

        const image = new Image();
        this.probeImage = image;
        image.onload = (): void => {
            this.probeImage = undefined;
            if (this.isDisposed || !this.state.imgError) {
                return;
            }
            this.reloadImage();
        };
        image.onerror = (): void => {
            this.probeImage = undefined;
        };
        image.src = url;
    };

    /**
     * Requests the image again from scratch, with a fresh set of automatic retries. Used for the
     * user clicking the error message, and for the automatic recoveries above.
     */
    private reloadImage = (): void => {
        if (this.isDisposed || !this.props.mediaVisible || (!this.state.error && !this.state.imgError)) {
            return;
        }

        this.clearRetryTimeout();
        this.stopFailedImageRecovery();
        this.state = {
            ...this.state,
            // Cleared so downloadImage resolves both URLs again - the thumbnail one was dropped
            // when it failed, and without it the full-size image would be shown from here on.
            contentUrl: null,
            thumbUrl: null,
            error: null,
            imgError: false,
            imgLoaded: false,
            retryCount: 0,
            cacheBust: this.state.cacheBust + 1,
            placeholder: this.props.mxEvent.getContent<ImageContent>().info?.[BLURHASH_FIELD]
                ? ImageBodyViewPlaceholder.NONE
                : ImageBodyViewPlaceholder.SPINNER,
        };
        this.updateSnapshotFromState();
        this.scheduleBlurhashPlaceholder();
        void this.downloadImage();
    };

    /**
     * An <img> element reports that it failed but never why, so ask for the same URL once more
     * just to write the server's answer to the log - otherwise there is nothing to go on when a
     * failed image is reported.
     */
    private async logImageFailureReason(): Promise<void> {
        const url = ImageBodyViewModel.withRetryCacheBust(this.state.contentUrl, this.state.cacheBust);
        if (!url || !/^https?:/i.test(url)) {
            return;
        }

        const eventId = this.props.mxEvent.getId();
        const abortController = new AbortController();
        try {
            const response = await fetch(url, { signal: abortController.signal });
            const detail = response.ok ? "" : ` ${(await response.text()).slice(0, 300)}`;
            logger.warn(`Image for ${eventId} failed to load: HTTP ${response.status}${detail}`);
        } catch (error) {
            logger.warn(`Image for ${eventId} failed to load: request failed`, error);
        } finally {
            // Only the status was wanted, not the image itself.
            abortController.abort();
        }
    }

    private revokeGeneratedThumbnailUrl(): void {
        if (!this.state.generatedThumbnailUrl) {
            return;
        }

        URL.revokeObjectURL(this.state.generatedThumbnailUrl);
        this.state = {
            ...this.state,
            generatedThumbnailUrl: null,
        };
    }

    private clearBlurhashTimeout(): void {
        if (!this.blurhashTimeout) {
            return;
        }

        clearTimeout(this.blurhashTimeout);
        this.blurhashTimeout = undefined;
    }

    private scheduleBlurhashPlaceholder(): void {
        if (
            !this.props.mxEvent.getContent<ImageContent>().info?.[BLURHASH_FIELD] ||
            this.state.imgLoaded ||
            this.state.imgError
        ) {
            return;
        }

        this.clearBlurhashTimeout();
        this.blurhashTimeout = window.setTimeout(() => {
            if (this.isDisposed || this.state.imgLoaded || this.state.imgError) {
                return;
            }

            this.state = {
                ...this.state,
                placeholder: ImageBodyViewPlaceholder.BLURHASH,
            };
            this.snapshot.merge({ placeholder: ImageBodyViewPlaceholder.BLURHASH });
        }, 150);
    }

    private getThumbUrl(): string | null {
        const thumbWidth = 800;
        const thumbHeight = 600;

        const content = this.props.mxEvent.getContent<ImageContent>();
        const media = mediaFromContent(content);
        const info = content.info;

        if (info?.mimetype === "image/svg+xml" && media.hasThumbnail) {
            return media.getThumbnailHttp(thumbWidth, thumbHeight, "scale");
        }

        if (this.state.isAnimated || window.devicePixelRatio === 1.0 || !info || !info.w || !info.h || !info.size) {
            return media.getThumbnailOfSourceHttp(thumbWidth, thumbHeight);
        }

        const isLargerThanThumbnail = info.w > thumbWidth || info.h > thumbHeight;
        const isLargeFileSize = info.size > 1 * 1024 * 1024;

        if (isLargeFileSize && isLargerThanThumbnail) {
            return media.getThumbnailOfSourceHttp(thumbWidth, thumbHeight);
        }

        return media.srcHttp;
    }

    private async downloadImage(): Promise<void> {
        if (this.state.contentUrl || this.props.forExport) {
            return;
        }

        let thumbUrl: string | null;
        let contentUrl: string | null;

        if (isHeicMimeType(this.props.mxEvent.getContent<ImageContent>().info?.mimetype)) {
            // The browser cannot draw this format, so show a converted copy instead. It also
            // stands in for the thumbnail - the server usually cannot make one of these.
            const mxEvent = this.props.mxEvent;
            const media = mediaFromContent(mxEvent.getContent<ImageContent>());
            // The helper is only needed for bytes that are not a plain download. It also remembers
            // a failed download for good, which would make trying again pointless.
            const mediaEventHelper =
                this.props.mediaEventHelper?.media.isEncrypted || this.props.mediaEventHelper?.isFromLocalUpload
                    ? this.props.mediaEventHelper
                    : undefined;
            try {
                contentUrl = await getHeicDisplayUrl(media.srcMxc, async () =>
                    mediaEventHelper ? mediaEventHelper.sourceBlob.value : (await media.downloadSource()).blob(),
                );
            } catch (error) {
                if (this.isDisposed || this.props.mxEvent !== mxEvent) {
                    return;
                }

                logger.error("Unable to convert HEIC image: ", error);
                this.state = {
                    ...this.state,
                    error: error as Error,
                };
                this.updateSnapshotFromState();
                return;
            }

            if (this.isDisposed || this.props.mxEvent !== mxEvent) {
                return;
            }
            thumbUrl = contentUrl;
        } else if (this.props.mediaEventHelper?.media.isEncrypted || this.props.mediaEventHelper?.isFromLocalUpload) {
            try {
                [contentUrl, thumbUrl] = await Promise.all([
                    this.props.mediaEventHelper.sourceUrl.value,
                    this.props.mediaEventHelper.thumbnailUrl.value,
                ]);
            } catch (error) {
                if (this.isDisposed) {
                    return;
                }

                if (error instanceof DecryptError) {
                    logger.error("Unable to decrypt attachment: ", error);
                } else if (error instanceof DownloadError) {
                    logger.error("Unable to download attachment to decrypt it: ", error);
                } else {
                    logger.error("Error encountered when downloading encrypted attachment: ", error);
                }

                this.state = {
                    ...this.state,
                    error: error as Error,
                };
                this.updateSnapshotFromState();
                return;
            }
        } else {
            contentUrl = mediaFromContent(this.props.mxEvent.getContent<ImageContent>()).srcHttp;
            thumbUrl = this.getThumbUrl();
        }

        const content = this.props.mxEvent.getContent<ImageContent>();
        let generatedThumbnailUrl: string | null = null;
        let isAnimated = (content.info as ImageInfoWithAnimationFlag | undefined)?.["org.matrix.msc4230.is_animated"];
        if (isAnimated === undefined) {
            isAnimated = mayBeAnimated(content.info?.mimetype);
        }

        const autoplayGifs = SettingsStore.getValue("autoplayGifs") as boolean;
        if (isAnimated && !autoplayGifs) {
            if (!thumbUrl || !content.info?.thumbnail_info || mayBeAnimated(content.info.thumbnail_info.mimetype)) {
                const image = document.createElement("img");
                const loadPromise = new Promise<void>((resolve, reject) => {
                    image.onload = (): void => resolve();
                    image.onerror = (): void => reject(new Error("Unable to load image"));
                });

                image.crossOrigin = "Anonymous";
                image.src = contentUrl ?? "";

                try {
                    await loadPromise;
                } catch (error) {
                    logger.error("Unable to download attachment: ", error);
                    this.state = {
                        ...this.state,
                        error: error as Error,
                    };
                    this.updateSnapshotFromState();
                    return;
                }

                try {
                    if (
                        (content.info as ImageInfoWithAnimationFlag | undefined)?.["org.matrix.msc4230.is_animated"] ===
                            false ||
                        (this.props.mediaEventHelper &&
                            (await blobIsAnimated(await this.props.mediaEventHelper.sourceBlob.value)) === false)
                    ) {
                        isAnimated = false;
                    }

                    if (isAnimated) {
                        const thumbnail = await createThumbnail(
                            image,
                            image.width,
                            image.height,
                            content.info?.mimetype ?? "image/jpeg",
                            false,
                        );
                        generatedThumbnailUrl = URL.createObjectURL(thumbnail.thumbnail);
                        thumbUrl = generatedThumbnailUrl;
                    }
                } catch (error) {
                    logger.warn("Unable to generate thumbnail for animated image: ", error);
                }
            }
        }

        if (this.isDisposed) {
            if (generatedThumbnailUrl) {
                URL.revokeObjectURL(generatedThumbnailUrl);
            }
            return;
        }

        this.revokeGeneratedThumbnailUrl();
        this.state = {
            ...this.state,
            contentUrl,
            thumbUrl,
            isAnimated,
            error: null,
            generatedThumbnailUrl,
        };
        this.updateSnapshotFromState();
    }

    private openImageViewer(event: MouseEvent<HTMLAnchorElement>): void {
        if (event.button !== 0 || event.metaKey) {
            return;
        }

        event.preventDefault();

        if (!this.props.mediaVisible) {
            this.props.setMediaVisible?.(true);
            return;
        }

        const content = this.props.mxEvent.getContent<ImageContent>();

        let httpUrl = this.state.contentUrl;
        if (
            this.props.mediaEventHelper?.media.isEncrypted &&
            !isMimeTypeAllowed(this.props.mediaEventHelper.sourceBlob.cachedValue?.type ?? "")
        ) {
            httpUrl = this.state.thumbUrl;
        }

        if (!httpUrl) {
            return;
        }

        const params: Omit<ComponentProps<typeof ImageView>, "onFinished"> = {
            src: httpUrl,
            name: content.body && content.body.length > 0 ? content.body : _t("common|attachment"),
            mxEvent: this.props.mxEvent,
            permalinkCreator: this.props.permalinkCreator,
        };

        if (content.info) {
            params.width = content.info.w;
            params.height = content.info.h;
            params.fileSize = content.info.size;
        }

        if (this.props.imageRef.current) {
            const clientRect = this.props.imageRef.current.getBoundingClientRect();
            params.thumbnailInfo = {
                width: clientRect.width,
                height: clientRect.height,
                positionX: clientRect.x,
                positionY: clientRect.y,
            };
        }

        Modal.createDialog(ImageView, params, "mx_Dialog_lightbox", undefined, true);
    }

    public onLinkClick = (event: MouseEvent<HTMLAnchorElement>): void => {
        this.openImageViewer(event);
    };

    public onHiddenButtonClick = (): void => {
        this.props.setMediaVisible?.(true);
    };

    public onRetryClick = (): void => {
        this.reloadImage();
    };

    public onImageError = (): void => {
        if (this.state.thumbUrl && this.state.thumbUrl !== this.state.contentUrl) {
            this.state = {
                ...this.state,
                thumbUrl: null,
            };
            this.updateSnapshotFromState();
            return;
        }

        this.clearBlurhashTimeout();

        if (this.state.imgError) {
            return;
        }

        // Nothing to retry for a blob: URL - its bytes are already in memory.
        const canRetry = /^https?:/i.test(this.state.contentUrl ?? "");
        if (canRetry && this.state.retryCount < IMAGE_LOAD_RETRY_DELAYS_MS.length) {
            const delay = IMAGE_LOAD_RETRY_DELAYS_MS[this.state.retryCount];
            this.clearRetryTimeout();
            this.retryTimeout = window.setTimeout(() => {
                this.retryTimeout = undefined;
                if (this.isDisposed) {
                    return;
                }

                this.state = {
                    ...this.state,
                    retryCount: this.state.retryCount + 1,
                    cacheBust: this.state.cacheBust + 1,
                };
                this.updateSnapshotFromState();
            }, delay);
            return;
        }

        void this.logImageFailureReason();
        this.state = {
            ...this.state,
            imgError: true,
        };
        this.startFailedImageRecovery();
        this.updateSnapshotFromState();
    };

    public onImageLoad = (): void => {
        this.clearBlurhashTimeout();

        let loadedImageDimensions: LoadedImageDimensions | undefined;
        if (this.props.imageRef.current) {
            const { naturalWidth, naturalHeight } = this.props.imageRef.current;
            loadedImageDimensions = { naturalWidth, naturalHeight };
        }

        this.state = {
            ...this.state,
            imgLoaded: true,
            loadedImageDimensions,
            placeholder: ImageBodyViewPlaceholder.NONE,
        };
        this.updateSnapshotFromState();
    };

    public setEvent(mxEvent: MatrixEvent, mediaEventHelper?: MediaEventHelper): void {
        if (this.props.mxEvent === mxEvent && this.props.mediaEventHelper === mediaEventHelper) {
            return;
        }

        const previousVisible = this.props.mediaVisible;
        this.props = {
            ...this.props,
            mxEvent,
            mediaEventHelper,
        };
        this.resetState(mxEvent);
        this.updateSnapshotFromState();

        if (previousVisible) {
            this.scheduleBlurhashPlaceholder();
            void this.downloadImage();
        }
    }

    public setForExport(forExport?: boolean): void {
        if (this.props.forExport === forExport) {
            return;
        }

        this.props = {
            ...this.props,
            forExport,
        };
        this.updateSnapshotFromState();
    }

    public setMaxImageHeight(maxImageHeight?: number): void {
        if (this.props.maxImageHeight === maxImageHeight) {
            return;
        }

        this.props = {
            ...this.props,
            maxImageHeight,
        };
        this.updateSnapshotFromState();
    }

    public setMediaVisible(mediaVisible: boolean): void {
        if (this.props.mediaVisible === mediaVisible) {
            return;
        }

        const wasVisible = this.props.mediaVisible;
        this.props = {
            ...this.props,
            mediaVisible,
        };
        this.updateSnapshotFromState();

        if (!wasVisible && mediaVisible) {
            this.scheduleBlurhashPlaceholder();
            void this.downloadImage();
        }
    }

    public setPermalinkCreator(permalinkCreator?: RoomPermalinkCreator): void {
        if (this.props.permalinkCreator === permalinkCreator) {
            return;
        }

        this.props = {
            ...this.props,
            permalinkCreator,
        };
    }

    public setTimelineRenderingType(timelineRenderingType: TimelineRenderingType): void {
        if (this.props.timelineRenderingType === timelineRenderingType) {
            return;
        }

        this.props = {
            ...this.props,
            timelineRenderingType,
        };
        this.snapshot.merge(ImageBodyViewModel.computeSnapshot(this.props, this.state));
    }

    public setSetMediaVisible(setMediaVisible?: (visible: boolean) => void): void {
        if (this.props.setMediaVisible === setMediaVisible) {
            return;
        }

        this.props = {
            ...this.props,
            setMediaVisible,
        };
    }

    private setImageSize(imageSize: ImageSize): void {
        if (this.state.imageSize === imageSize) {
            return;
        }

        this.state = {
            ...this.state,
            imageSize,
        };
        this.updateSnapshotFromState();
    }

    public dispose(): void {
        this.clearBlurhashTimeout();
        this.clearRetryTimeout();
        this.stopFailedImageRecovery();
        this.revokeGeneratedThumbnailUrl();
        super.dispose();
    }
}

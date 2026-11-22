/*
 * Haven - entry point of app_popout.html, the window an app pops out into.
 *
 * Haven's main window draws the app into this page itself (see AppPopoutStore.ts), so the page
 * runs almost nothing of its own. The one thing it has to do is answer the service worker: media
 * this page shows is fetched through it, and it asks the page that made the request which account
 * to sign the request for, as WebPlatform does for the main window.
 */

interface UserInfoRequest {
    type?: string;
    responseKey?: string;
}

navigator.serviceWorker?.addEventListener("message", (event: MessageEvent<UserInfoRequest>) => {
    if (event.data?.type !== "userinfo" || !event.data.responseKey) return;
    const opener = window.opener as { mxMatrixClientPeg?: { get(): { getHomeserverUrl(): string } | null } } | null;
    event.source?.postMessage({
        responseKey: event.data.responseKey,
        userId: localStorage.getItem("mx_user_id"),
        deviceId: localStorage.getItem("mx_device_id"),
        homeserver: opener?.mxMatrixClientPeg?.get()?.getHomeserverUrl() ?? localStorage.getItem("mx_hs_url"),
    });
});

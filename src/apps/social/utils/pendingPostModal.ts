/*
 * Social Overlay — pendingPostModal
 *
 * Bridges a "#/social?post=1&text=..." deep link's request to open the Post composer (optionally
 * prefilled) into SocialHomeView, which doesn't exist yet at the moment permalinkRouting.ts's
 * tryRouteSocialHashScreen parses the URL and dispatches SOCIAL_HOME_ACTION to create it - same
 * "click/navigation before mount" problem pendingViewUser.ts solves for other Social entry points.
 *
 * Consumed (destructively, not peeked) in a mount effect - safe here despite the same StrictMode
 * double-invoke other bridges (e.g. pendingFocusEvent.ts) had to work around, because this only
 * ever triggers a Modal.createDialog call: a side effect entirely independent of which particular
 * mount instance fires it (Modal.createDialog manages its own lifecycle via ModalManager, not tied
 * to the triggering component's own state at all) - unlike pendingFocusEvent's threadEvent, which
 * had to become component STATE that a StrictMode-discarded throwaway mount would otherwise lose.
 * All that matters here is that the modal opens exactly once, not which mount does it.
 */
export interface PendingPostModal {
    /** Prefilled composer body - undefined opens the modal empty. */
    text?: string;
}

let pendingPostModal: PendingPostModal | null = null;

export function setPendingPostModal(modal: PendingPostModal): void {
    pendingPostModal = modal;
}

export function consumePendingPostModal(): PendingPostModal | null {
    const p = pendingPostModal;
    pendingPostModal = null;
    return p;
}

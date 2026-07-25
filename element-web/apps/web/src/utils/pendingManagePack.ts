/*
 * Haven: pendingManagePack
 *
 * Bridges "open Room Settings' Emoji & Stickers tab with this exact pack's own editor already
 * open" from the emoji picker's manage-gear click (EmojiPicker.tsx) into
 * EmojiStickersRoomSettingsTab, which doesn't exist yet at the moment open_room_settings is
 * dispatched to create the dialog in the first place - same "click happened before the component
 * existed to hear about it" problem the pendingViewPost/pendingFocusEvent family of bridges solves
 * elsewhere in this codebase (see src/apps/social/utils/ for that pattern's fuller doc).
 *
 * Consumed via a lazy useState initializer (not a mount effect), so it's captured before render
 * rather than racing a StrictMode double-invoke. A destructive single consume is fine here (unlike
 * pendingFocusEvent's own non-destructive peek) - only one EmojiStickersRoomSettingsTab instance is
 * ever created per Room Settings dialog open, so there's no throwaway mount that could consume this
 * before the real one gets a chance to.
 */
let pendingStateKey: string | null = null;

export function setPendingManagePackStateKey(stateKey: string): void {
    pendingStateKey = stateKey;
}

export function consumePendingManagePackStateKey(): string | null {
    const key = pendingStateKey;
    pendingStateKey = null;
    return key;
}

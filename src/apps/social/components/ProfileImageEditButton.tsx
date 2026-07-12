/*
 * Social Overlay — ProfileImageEditButton
 *
 * Pencil-in-the-corner edit affordance for a profile's own avatar/banner, reusing the exact same
 * dropdown menu (Upload file / Remove) and file input handling AvatarSetting.tsx/BannerSetting.tsx
 * already use in Room Settings. Unlike those, this uploads immediately on selection rather than
 * deferring to a Save button — SocialRoomView has no such save step, avatar/banner changes there
 * take effect the moment you pick a file, the same way the rest of the profile page works.
 */

import React, { type JSX, useCallback, useRef, useState } from "react";
import EditIcon from "@vector-im/compound-design-tokens/assets/web/icons/edit";

import { chromeFileInputFix } from "../../../../element-web/apps/web/src/utils/BrowserWorkarounds";
import { getFileChanged, AvatarSettingContextMenu } from "../../../../element-web/apps/web/src/components/views/settings/AvatarSetting";

interface Props {
    /** aria-label for the button, e.g. "Edit avatar" / "Edit banner". */
    label: string;
    onUpload: (file: File) => void;
    /** Omit to hide the "Remove" menu item entirely (e.g. avatar has no remove action). */
    onRemove?: () => void;
    className?: string;
}

export function ProfileImageEditButton({ label, onUpload, onRemove, className }: Props): JSX.Element {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [menuOpen, setMenuOpen] = useState(false);

    const onFileChanged = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = getFileChanged(e);
            if (file) onUpload(file);
        },
        [onUpload],
    );

    const trigger = (
        <div
            className={`social_ProfileImageEditButton${menuOpen ? " social_ProfileImageEditButton--active" : ""}${className ? ` ${className}` : ""}`}
            role="button"
            aria-label={label}
            tabIndex={0}
            aria-haspopup="menu"
        >
            <EditIcon aria-hidden width="20px" height="20px" />
        </div>
    );

    return (
        <>
            <AvatarSettingContextMenu
                trigger={trigger}
                onUploadSelect={() => fileInputRef.current?.click()}
                onRemoveSelect={onRemove}
                menuOpen={menuOpen}
                onOpenChange={setMenuOpen}
            />
            <input
                type="file"
                style={{ display: "none" }}
                ref={fileInputRef}
                onClick={chromeFileInputFix}
                onChange={onFileChanged}
                accept="image/*"
            />
        </>
    );
}

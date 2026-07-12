/*
 * Social Overlay — BannerSetting
 *
 * A general room banner editor (MSC4221), styled to match AvatarSetting.tsx's own pencil-icon-in-
 * the-corner affordance and reusing its exact context menu (Upload file / Remove). Unlike the old
 * version of this component, it's a *controlled* component exactly like AvatarSetting — the caller
 * (RoomProfileSettings.tsx) owns the pending file/removal state and only actually uploads/sends on
 * Save, so selecting a file previews it here without touching the room's state until Save is
 * clicked, matching every other field in Room Settings' General tab.
 */

import React, { type JSX, useCallback, useEffect, useState } from "react";
import EditIcon from "@vector-im/compound-design-tokens/assets/web/icons/edit";

import { mediaFromMxc } from "../../../../element-web/apps/web/src/customisations/Media";
import { chromeFileInputFix } from "../../../../element-web/apps/web/src/utils/BrowserWorkarounds";
import { getFileChanged, AvatarSettingContextMenu } from "../../../../element-web/apps/web/src/components/views/settings/AvatarSetting";

interface Props {
    /** The current banner, as an mxc URL (already-saved banner) or a File (freshly selected, not
     *  yet saved) — same convention as AvatarSetting's own `avatar` prop. */
    banner?: string | File;
    disabled?: boolean;
    /** Called when the user selects a new banner file. Doesn't upload/send anything itself. */
    onChange?: (f: File) => void;
    /** Called when the user chooses to remove the banner. Only shown when a banner is set. */
    removeBanner?: () => void;
}

export function BannerSetting({ banner, disabled, onChange, removeBanner }: Props): JSX.Element {
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const [menuOpen, setMenuOpen] = useState(false);

    const [bannerUrl, setBannerUrl] = useState<string | undefined>(undefined);
    useEffect(() => {
        if (banner instanceof File) {
            const reader = new FileReader();
            reader.onload = () => setBannerUrl(reader.result as string);
            reader.readAsDataURL(banner);
        } else if (banner) {
            setBannerUrl(mediaFromMxc(banner).srcHttp ?? undefined);
        } else {
            setBannerUrl(undefined);
        }
    }, [banner]);

    const onFileChanged = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = getFileChanged(e);
            if (file) onChange?.(file);
        },
        [onChange],
    );

    const content = (
        <div className="social_BannerSetting_display" role="group" aria-label="Room banner">
            {bannerUrl ? (
                <img className="social_BannerSetting_image" src={bannerUrl} alt="" />
            ) : (
                <div className="social_BannerSetting_placeholder" />
            )}
            {!disabled && (
                <div
                    className={`social_BannerSetting_editButton${menuOpen ? " social_BannerSetting_editButton--active" : ""}`}
                    role="button"
                    aria-label="Edit room banner"
                    tabIndex={0}
                    aria-haspopup="menu"
                >
                    <EditIcon aria-hidden width="20px" height="20px" />
                </div>
            )}
        </div>
    );

    return (
        <div className="social_BannerSetting">
            <div className="social_BannerSetting_heading">Room Banner</div>
            {disabled ? (
                content
            ) : (
                <AvatarSettingContextMenu
                    trigger={content}
                    onUploadSelect={() => fileInputRef.current?.click()}
                    onRemoveSelect={removeBanner}
                    menuOpen={menuOpen}
                    onOpenChange={setMenuOpen}
                />
            )}
            <input
                type="file"
                style={{ display: "none" }}
                ref={fileInputRef}
                onClick={chromeFileInputFix}
                onChange={onFileChanged}
                accept="image/*"
                disabled={disabled}
            />
        </div>
    );
}

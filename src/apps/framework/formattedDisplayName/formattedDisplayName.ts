/*
 * Haven - MSC4589 formatted display names: an optional "m.formatted_displayname" object
 * ({ format, formatted_body }) next to `displayname`, in profiles, m.room.member events and
 * MSC4144 per-message profiles, holding the name as a strictly inline subset of message HTML
 * (bold, italics, underline, strikethrough and custom emoji). Display only, behind a lab.
 *
 * The formatted name is only used when its text (with each emoji replaced by its alt text) is
 * exactly the plain `displayname`, so it can never read as a different name than the one used for
 * mentions, disambiguation and everything else.
 */

import sanitizeHtml from "sanitize-html";
import { type RoomMember } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";

import { mediaFromMxc } from "../../../../element-web/apps/web/src/customisations/Media";
import SettingsStore from "../../../../element-web/apps/web/src/settings/SettingsStore";
import { MatrixClientPeg } from "../../../../element-web/apps/web/src/MatrixClientPeg";

export const FORMATTED_DISPLAYNAME_STABLE_KEY = "m.formatted_displayname";
export const FORMATTED_DISPLAYNAME_UNSTABLE_KEY = "org.matrix.msc4589.formatted_displayname";
export const FORMATTED_DISPLAYNAMES_LAB = "feature_msc4589_formatted_displaynames";

const HTML_FORMAT = "org.matrix.custom.html";
const MAX_BYTES = 1024;
const MAX_IMAGES = 10;
const MAX_DEPTH = 10;

/** Inline formatting tags the MSC permits, none of which may carry attributes. */
const FORMAT_TAGS_LIST = ["b", "strong", "i", "em", "u", "s", "del"];
const FORMAT_TAGS = new Set(FORMAT_TAGS_LIST);

/** An mxc:// URI: a server name (host, IPv4/IPv6 literal, optional port) and a media ID, nothing else. */
const MXC_URI = /^mxc:\/\/[A-Za-z0-9.\-:[\]]{1,255}\/[A-Za-z0-9_-]{1,255}$/;

/**
 * The second, independent pass over the HTML built below (see formattedDisplayNameHtml): what it
 * builds already only holds these, so this only ever changes anything if that code has a bug.
 */
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
    allowedTags: [...FORMAT_TAGS_LIST, "img"],
    allowedAttributes: { img: ["src", "alt", "title", "class", "data-mx-emoticon", "loading"] },
    allowedSchemes: ["https", "http"],
    allowedSchemesAppliedToAttributes: ["src"],
    allowProtocolRelative: false,
    allowedClasses: { img: [] }, // Set below, once EMOJI_CLASS exists.
    disallowedTagsMode: "escape",
    parser: { lowerCaseTags: true },
};

/** The class on each emoji image, sized to the text around it (see apps-framework.scss). */
export const EMOJI_CLASS = "haven_FormattedDisplayName_emoji";
SANITIZE_OPTIONS.allowedClasses = { img: [EMOJI_CLASS] };

/** `toHttp`'s URL for an emoji, if it's a plain http(s) URL. */
function safeHttpUrl(url: string | null): string | null {
    if (!url) return null;
    try {
        const { protocol } = new URL(url, window.location.href);
        return protocol === "https:" || protocol === "http:" ? url : null;
    } catch {
        return null;
    }
}

/** The raw formatted name object from an event's content or a profile, under either key. */
export function getRawFormattedDisplayName(content: Record<string, unknown> | undefined): unknown {
    return content?.[FORMATTED_DISPLAYNAME_UNSTABLE_KEY] ?? content?.[FORMATTED_DISPLAYNAME_STABLE_KEY];
}

/**
 * The formatted name `raw` as safe HTML to render in place of `displayname`, or undefined when it
 * isn't valid or its text isn't exactly `displayname`.
 *
 * Injection: the input is only ever parsed into an inert document (DOMParser runs no scripts and
 * loads nothing), and never rendered or cleaned in place. The output is built afresh from new
 * elements of the permitted tags only, with no attributes copied over except an emoji's alt and
 * title (set as attribute values, so escaped) and a src made by `toHttp` from a strictly checked
 * mxc:// URI and checked to be http(s). Everything else becomes text nodes, which serialize
 * escaped. The result then goes through sanitize-html with the same allowlist as a second pass.
 */
export function formattedDisplayNameHtml(
    raw: unknown,
    displayname: string | undefined,
    toHttp: (mxc: string) => string | null,
): string | undefined {
    if (!displayname || !raw || typeof raw !== "object") return undefined;
    const { format, formatted_body: body } = raw as { format?: unknown; formatted_body?: unknown };
    if (format !== HTML_FORMAT || typeof body !== "string" || !body) return undefined;
    if (new TextEncoder().encode(body).length > MAX_BYTES) return undefined;

    const source = new DOMParser().parseFromString(`<body>${body}</body>`, "text/html").body;
    // Built in an inert document too, so nothing loads until React renders the result.
    const doc = document.implementation.createHTMLDocument("");
    const out = doc.createElement("span");
    let text = "";
    let images = 0;
    let tooDeep = false;

    const copy = (from: Node, to: Node, depth: number): void => {
        if (depth > MAX_DEPTH) {
            tooDeep = true;
            return;
        }
        for (const node of Array.from(from.childNodes)) {
            if (node.nodeType === Node.TEXT_NODE) {
                text += node.textContent ?? "";
                to.appendChild(doc.createTextNode(node.textContent ?? ""));
                continue;
            }
            if (!(node instanceof Element)) continue; // Comments and the like.
            const tag = node.tagName.toLowerCase();
            if (tag === "img") {
                images++;
                const alt = node.getAttribute("alt") ?? "";
                text += alt;
                const src = node.getAttribute("src") ?? "";
                const http =
                    node.hasAttribute("data-mx-emoticon") && MXC_URI.test(src) ? safeHttpUrl(toHttp(src)) : null;
                if (http) {
                    const img = doc.createElement("img");
                    img.className = EMOJI_CLASS;
                    img.src = http;
                    img.alt = alt;
                    img.title = node.getAttribute("title") || alt;
                    img.setAttribute("data-mx-emoticon", "");
                    img.loading = "lazy";
                    to.appendChild(img);
                } else {
                    // Not a custom emoji: shown as its alt text.
                    to.appendChild(doc.createTextNode(alt));
                }
            } else if (FORMAT_TAGS.has(tag)) {
                const el = doc.createElement(tag);
                to.appendChild(el);
                copy(node, el, depth + 1);
            } else {
                // Not permitted: dropped, keeping its text (the text check then usually fails).
                copy(node, to, depth + 1);
            }
        }
    };
    copy(source, out, 0);

    if (tooDeep || images > MAX_IMAGES || text !== displayname) return undefined;
    return sanitizeHtml(out.innerHTML, SANITIZE_OPTIONS);
}

/** Whether formatted display names are turned on (the lab). */
export function formattedDisplayNamesEnabled(): boolean {
    return SettingsStore.getValue(FORMATTED_DISPLAYNAMES_LAB);
}

/**
 * The formatted name in `content` (a member event's, a profile's or a per-message profile's) as
 * safe HTML, when the lab is on and it matches `displayname`. Emoji keep animating, as custom
 * emoji in messages do (see Linkify.ts's img transform).
 */
export function getFormattedDisplayNameHtml(
    content: Record<string, unknown> | undefined,
    displayname: string | undefined,
): string | undefined {
    return renderFormattedDisplayName(getRawFormattedDisplayName(content), displayname);
}

/** {@link getFormattedDisplayNameHtml} for a formatted name already read out (see getRawFormattedDisplayName). */
export function renderFormattedDisplayName(raw: unknown, displayname: string | undefined): string | undefined {
    if (!raw || !formattedDisplayNamesEnabled()) return undefined;
    return formattedDisplayNameHtml(raw, displayname, (mxc) => mediaFromMxc(mxc).srcHttp);
}

/** A user's global profile, as far as formatted names go (see liveUserProfile.ts's LiveUserProfile). */
export interface ProfileNames {
    displayName?: string;
    formattedDisplayName?: unknown;
}

/**
 * A room member's formatted name as safe HTML, checked against the plain name `member` shows
 * (rawDisplayName). Taken from, in order: the member event `member` was built from (a historical
 * sender's name at the time), the user's current member event in the room (so older messages pick
 * up a formatted name added since), and their global profile, if given. The last two only when
 * their own plain name is that same name.
 *
 * Plain names only for anyone in the room who isn't currently joined: invited, left, kicked or
 * banned (MSC4589's "where formatted names are rendered"). A member made up from a profile, with
 * no room (see usePermalinkMember's createMemberFromProfile), isn't subject to that.
 */
export function getMemberFormattedDisplayNameHtml(
    member: RoomMember | undefined | null,
    profile?: ProfileNames | null,
): string | undefined {
    const displayname = member?.rawDisplayName;
    if (!member || !displayname || displayname === member.userId) return undefined;
    const room = member.roomId ? MatrixClientPeg.get()?.getRoom(member.roomId) : undefined;
    const current = room?.getMember(member.userId) ?? undefined;
    const currentContent = current && current !== member ? current.events.member?.getContent() : undefined;
    const candidates = [
        getRawFormattedDisplayName(member.events.member?.getContent()),
        currentContent?.displayname === displayname ? getRawFormattedDisplayName(currentContent) : undefined,
        profile?.displayName === displayname ? profile.formattedDisplayName : undefined,
    ].filter(Boolean);
    // Most members have none: checked before the setting, which costs more.
    if (!candidates.length || !formattedDisplayNamesEnabled()) return undefined;
    if (member.roomId && (current ?? member).membership !== KnownMembership.Join) return undefined;
    for (const raw of candidates) {
        const html = renderFormattedDisplayName(raw, displayname);
        if (html) return html;
    }
    return undefined;
}

/** {@link getMemberFormattedDisplayNameHtml} for a user's current membership of a room. */
export function getUserFormattedDisplayNameHtml(roomId: string, userId: string): string | undefined {
    return getMemberFormattedDisplayNameHtml(MatrixClientPeg.get()?.getRoom(roomId)?.getMember(userId));
}

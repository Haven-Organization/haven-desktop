/*
 * Social Overlay — Slash commands for the post composer
 *
 * Reuses the exact same slash-command machinery the stock room composer uses
 * (SlashCommands.tsx/editor/commands.tsx) rather than reimplementing any of it - every command
 * that's enabled for a given room (isEnabled checks power levels/room state the same way it always
 * does) works here too, since a Social room is still a real Matrix room underneath. Commands that
 * perform a room action directly (/invite, /topic, /ban, etc.) just run and produce nothing to
 * post; commands that transform the message text (/me, /plain, /rainbow, /shrug, etc.) hand back
 * the transformed body for the caller to post through Social's own sendPost/sendComment instead of
 * the stock mxClient.sendMessage this same machinery normally feeds into.
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { getCommand, CommandCategories } from "../../../../element-web/apps/web/src/slash-commands/SlashCommands";
import { runSlashCommand, shouldSendAnyway } from "../../../../element-web/apps/web/src/editor/commands";
import { EMOTE_PREFIX } from "../../../../element-web/apps/web/src/components/views/rooms/wysiwyg_composer/utils/createMessageContent";
import Markdown from "../../../../element-web/apps/web/src/Markdown";
import SettingsStore from "../../../../element-web/apps/web/src/settings/SettingsStore";
import { getBlockquoteStyle } from "../../framework/config";
import { toGreentextHTML } from "../../framework/greentext";

export type SlashCommandResult =
    /** Nothing left to post - either a pure room-action command ran (e.g. /invite), the command
     *  errored (it already showed its own error dialog), or the user declined to send an unknown
     *  command as a literal message. `success` distinguishes "the command actually ran" (clear the
     *  composer) from "errored, or declined" (leave the typed text in place to fix/reconsider,
     *  same as the stock composer never clears on either of those). */
    | { handled: true; success: boolean }
    /** Post `body` as a normal Social post/reply - either this was never a slash command at all
     *  (the common case), or it was a message-transforming command (/me, /plain, /rainbow, etc.)
     *  and this is its resulting body. `formattedBody` carries a command's HTML formatting (e.g.
     *  /rainbow's per-letter colored spans) through to sendPost, the same as the stock composer's
     *  own formatted_body - undefined for a plain command result or an ordinary, non-command post.
     *  `isEmote` is only ever true for the ordinary-post fallback (see applyMarkdownAndEmote) -
     *  "/me ..." is deliberately excluded from being treated as a real command at all, same as
     *  stock, so it always reaches that fallback rather than the command branch above. */
    | { handled: false; body: string; formattedBody?: string; isEmote?: boolean };

/**
 * Runs an ordinary (non-command) post body through the same markdown-to-HTML conversion and "/me "
 * emote handling the stock composer applies to every message before sending - Social's own
 * composer is a plain textarea with no rich-text model of its own, so unlike the WYSIWYG composer's
 * createMessageContent.ts (which converts via matrix-wysiwyg's plainToRich), this uses the same
 * legacy commonmark-based Markdown class the plain-text composer (editor/serialize.ts) uses, which
 * is the more faithful match for what Social's composer actually is. Respects
 * MessageComposerInput.useMarkdown the same way stock does - if the user has turned markdown off
 * globally, Social's own posts shouldn't start markdown-ifying either.
 */
function applyMarkdownAndEmote(message: string): { body: string; formattedBody?: string; isEmote: boolean } {
    let isEmote = false;
    if (message.startsWith(EMOTE_PREFIX)) {
        isEmote = true;
        message = message.slice(EMOTE_PREFIX.length);
    } else if (message.startsWith("//")) {
        // A literal single leading slash, escaped - see createMessageContent's own identical check.
        message = message.slice(1);
    }

    if (!SettingsStore.getValue("MessageComposerInput.useMarkdown")) {
        return { body: message, isEmote };
    }
    const md = new Markdown(message);
    if (md.isPlainText()) {
        return { body: message, isEmote };
    }
    // "haven.blockquote_style" (default "stock") decides which of the two renderers below actually
    // runs - toGreentextHTML only exists to override block_quote's rendering, so there's nothing to
    // gate inside it; the choice is made once, here, between it and stock's own Markdown.toHTML().
    const formattedBody = getBlockquoteStyle() === "greentext" ? toGreentextHTML(message) : md.toHTML();
    return { body: message, formattedBody, isEmote };
}

/**
 * Checks `message` for a leading slash command and, if present, runs it. Returns what the caller
 * (Social's post composer) should do next - see SlashCommandResult. Mirrors the same
 * message.startsWith("/") / "//" / EMOTE_PREFIX branching
 * wysiwyg_composer/utils/message.ts's own sendMessage() uses, just without that function's
 * mxClient.sendMessage call at the end, since Social posts through its own sendPost/sendComment
 * instead.
 *
 * `roomId` is always the composer's own "post to" target room, which is a real, meaningful room
 * for every command *except* /devtools when this is called from the aggregated Feed tab (as
 * opposed to a specific profile/group room's own composer, see SocialRoomView.tsx) - the Feed
 * itself isn't a room (it merges posts from many), so opening devtools "on" whatever room happens
 * to be selected in the post-to dropdown would show an irrelevant Room ID and a Room tools section
 * that doesn't actually describe anything the user is looking at. `hasRoom` (false only from the
 * Feed's own call site) special-cases just this one command, opening DevtoolsDialog directly with
 * no room ID at all rather than plumbing "maybe no room" through the entire generic
 * runSlashCommand/Command.run/RunFn pipeline shared by every other command.
 */
export async function processSlashCommand(
    client: MatrixClient,
    roomId: string,
    message: string,
    hasRoom = true,
): Promise<SlashCommandResult> {
    if (message.startsWith("/") && !message.startsWith("//") && !message.startsWith(EMOTE_PREFIX)) {
        const { cmd, args } = getCommand(roomId, message);
        if (cmd?.command === "devtools" && !hasRoom) {
            const Modal = (await import("../../../../element-web/apps/web/src/Modal")).default;
            const DevtoolsDialog = (await import("../../../../element-web/apps/web/src/components/views/dialogs/DevtoolsDialog")).default;
            Modal.createDialog(DevtoolsDialog, { roomId: undefined, threadRootId: null }, "mx_DevtoolsDialog_wrapper");
            return { handled: true, success: true };
        }
        if (cmd) {
            const [content, commandSuccessful] = await runSlashCommand(client, cmd, args, roomId, null);
            // errored - runSlashCommand already showed why; leave the text in place to fix/retry.
            if (!commandSuccessful) return { handled: true, success: false };

            if (content && (cmd.category === CommandCategories.messages || cmd.category === CommandCategories.effects)) {
                const formattedBody = (content as { formatted_body?: string }).formatted_body;
                return { handled: false, body: content.body, formattedBody };
            }
            return { handled: true, success: true }; // pure room-action command (e.g. /invite) ran fine
        } else {
            const sendAnyway = await shouldSendAnyway(message);
            // declined - leave the text in place, same as the stock composer does.
            if (!sendAnyway) return { handled: true, success: false };
        }
    }
    return { handled: false, ...applyMarkdownAndEmote(message) };
}

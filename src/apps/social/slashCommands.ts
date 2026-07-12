/*
 * Social Overlay — slash commands
 *
 * `/setprofileroom` links the room the command is run in as the user's MSC4501 profile room
 * (org.matrix.msc4501.social.profile_room_id, a profile-info field pointing at a room id). Deliberately a
 * hidden slash command rather than a UI button/menu entry: this lets a power user point their
 * profile at any existing room they already have (not necessarily one created via Social's own
 * "create profile" flow), without exposing that capability to regular users who'd have no context
 * for what it means.
 */

import { Command } from "../../../element-web/apps/web/src/slash-commands/command";
import { CommandCategories } from "../../../element-web/apps/web/src/slash-commands/interface";
import { success } from "../../../element-web/apps/web/src/slash-commands/utils";
import { _td } from "../../../element-web/apps/web/src/languageHandler";
import { setProfileRoomLink } from "./utils/social-actions";

export const setProfileRoomCommand = new Command({
    command: "setprofileroom",
    description: _td("slash_command|setprofileroom"),
    category: CommandCategories.advanced,
    runFn: function (cli, roomId) {
        return success(setProfileRoomLink(cli, roomId));
    },
});

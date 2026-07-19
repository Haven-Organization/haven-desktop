/*
 * Social Overlay — createSocialRoom
 *
 * Creates profile/group rooms via the exact stock "New Room" flow (CreateRoomDialog +
 * createRoom()), customized just enough to talk about "profile"/"group" instead of "room" (see
 * CreateRoomDialog's entityNoun prop) — not a bespoke create form. Public + no end-to-end
 * encryption by default, matching the old custom forms' behavior.
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import Modal from "../../../../element-web/apps/web/src/Modal";
import CreateRoomDialog from "../../../../element-web/apps/web/src/components/views/dialogs/CreateRoomDialog";
import createRoom, { type IOpts } from "../../../../element-web/apps/web/src/createRoom";
import { MSC4501_ROOM_TYPE_PROFILE, MSC4501_ROOM_TYPE_GROUP, MSC4501_PROFILE_USER_ID_KEY } from "./room-classifier";
import { setProfileRoomLink } from "./social-actions";

async function openCreateSocialRoomDialog(
    client: MatrixClient,
    entityNoun: "profile" | "group",
    roomType: string,
    defaultName?: string,
): Promise<string | null> {
    const modal = Modal.createDialog(CreateRoomDialog, {
        entityNoun,
        defaultPublic: true,
        defaultAskToJoin: true,
        showAllowAnyonePost: true,
        defaultEncrypted: false,
        defaultName,
    });

    const [proceed, opts] = await modal.finished;
    if (!proceed || !opts) return null;

    const mergedOpts: IOpts = {
        ...opts,
        andView: false,
        createOpts: {
            ...opts.createOpts,
            creation_content: { ...opts.createOpts?.creation_content, type: roomType },
            // Reactions and the profile-owner marker get their own fixed power levels regardless
            // of the "Allow anyone to post" toggle (which only ever governs events_default, set
            // above by CreateRoomDialog itself) - merge onto it rather than replace, so that
            // toggle's choice survives.
            ...(entityNoun === "profile"
                ? {
                      power_level_content_override: {
                          ...opts.createOpts?.power_level_content_override,
                          events: {
                              ...opts.createOpts?.power_level_content_override?.events,
                              "m.reaction": 0,
                              // m.social.profile_user_id isn't one of the event types
                              // m.room.power_levels gives its own default override for, so left
                              // unset it would fall back to state_default (Moderator, not Admin) —
                              // any promoted moderator could reassign the profile out from under
                              // its actual owner. See MSC4501's Profile rooms section.
                              [MSC4501_PROFILE_USER_ID_KEY]: 100,
                          },
                      },
                      // MSC4501: a profile room asserts its true owner via this state event
                      // (state_key "") rather than relying solely on m.room.create's creator,
                      // since that's not always the same person (e.g. a bridge/appservice
                      // creating the room on someone's behalf).
                      initial_state: [
                          ...(opts.createOpts?.initial_state ?? []),
                          {
                              type: MSC4501_PROFILE_USER_ID_KEY,
                              state_key: "",
                              content: { user_id: client.getSafeUserId() },
                          },
                      ],
                  }
                : {}),
        },
    };

    const roomId = await createRoom(client, mergedOpts);
    if (roomId && entityNoun === "profile") {
        await setProfileRoomLink(client, roomId);
    }
    return roomId;
}

export function openCreateProfileDialog(client: MatrixClient): Promise<string | null> {
    const userId = client.getUserId() ?? "";
    const defaultName = client.getUser(userId)?.displayName ?? userId;
    return openCreateSocialRoomDialog(client, "profile", MSC4501_ROOM_TYPE_PROFILE, defaultName);
}

export function openCreateGroupDialog(client: MatrixClient): Promise<string | null> {
    return openCreateSocialRoomDialog(client, "group", MSC4501_ROOM_TYPE_GROUP);
}

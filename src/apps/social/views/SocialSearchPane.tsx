/*
 * Social Overlay - SocialSearchPane
 *
 * The Search section: one search box with People, Groups and Posts tabs under it, laid out like
 * a Mastodon-style search page.
 *
 * - People: everyone you share a room with until you type, then people matching the search
 *   (usePeopleSearch - the same sources Spotlight's People filter uses). Each row can follow
 *   that person's linked profile room (SocialPersonRow).
 * - Groups: a room directory listing limited to the MSC4501 group room type with the spec's
 *   `filter.room_types` (Matrix v1.4 / MSC3827), on a homeserver picked from Element's own
 *   NetworkDropdown, defaulting to your own homeserver.
 * - Posts: nothing until you search, then the server's full-text search over your joined Social
 *   rooms, ordered by relevance, with the matched words highlighted.
 */

import React, { type JSX, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    type IPublicRoomsChunkRoom,
    type ISearchResults,
    type MatrixClient,
    type MatrixEvent,
    type Room,
    type RoomType,
    EventType,
    RelationType,
    SearchOrderBy,
} from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";
import { SearchIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import Spinner from "../../../../element-web/apps/web/src/components/views/elements/Spinner";
import { NetworkDropdown } from "../../../../element-web/apps/web/src/components/views/directory/NetworkDropdown";
import { usePublicRoomDirectory } from "../../../../element-web/apps/web/src/hooks/usePublicRoomDirectory";
import { usePeopleSearch } from "../../../../element-web/apps/web/src/hooks/usePeopleSearch";
import { getMyReactions } from "../../../../element-web/apps/web/src/components/views/rooms/EventTile/ReactionsRowAdapter";
import { SocialPersonRow } from "../components/SocialPersonRow";
import { DirectoryGroupTile } from "../components/GroupTile";
import { SocialEventTile } from "../components/SocialEventTile";
import { useLoadMoreSentinel } from "../utils/useLoadMoreSentinel";
import { isSocialRoom, MSC4501_ROOM_TYPE_GROUP } from "../utils/room-classifier";
import { replyCountFor } from "../utils/thread-relations";
import { sendComment, sendLike, undoLike } from "../utils/social-actions";
import { processSlashCommand } from "../utils/socialSlashCommands";

export type SearchTab = "people" | "groups" | "posts";

/** How many people rows are rendered at first, and added each time the end of the list shows. */
const PEOPLE_PAGE_SIZE = 30;
/** How many groups to ask the room directory for. */
const GROUPS_LIMIT = 100;
/** Pause after typing before searching groups or posts, so each keystroke isn't its own request. */
const SEARCH_DEBOUNCE_MS = 400;

/** Kept across visits so leaving Search (e.g. to open a result) and coming back keeps your place. */
let lastSearchState: { tab: SearchTab; query: string } = { tab: "people", query: "" };

/** `value`, once it has stopped changing for `delayMs`. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const handle = setTimeout(() => setDebounced(value), delayMs);
        return () => clearTimeout(handle);
    }, [value, delayMs]);
    return debounced;
}

interface Props {
    client: MatrixClient;
    pillsGeneration: number;
    onViewUser: (userId: string) => void;
    onOpenUserPanel: (userId: string, room: Room) => void;
    onViewRoom: (roomId: string) => void;
    /** Opens a group found in a room directory: `via` is the directory's server. */
    onViewDirectoryGroup: (roomId: string, via: string[]) => void;
    onOpenPost: (event: MatrixEvent, room: Room) => void;
    onNavigateToProfile: () => void;
}

const TABS: Array<{ id: SearchTab; label: string }> = [
    { id: "people", label: "People" },
    { id: "groups", label: "Groups" },
    { id: "posts", label: "Posts" },
];

export function SocialSearchPane(props: Props): JSX.Element {
    const [tab, setTab] = useState<SearchTab>(lastSearchState.tab);
    const [query, setQuery] = useState(lastSearchState.query);

    useEffect(() => {
        lastSearchState = { tab, query };
    }, [tab, query]);

    return (
        <div className="social_Pane social_SearchPane">
            <div className="social_SearchPane_box">
                <input
                    type="search"
                    className="social_SearchPane_input"
                    placeholder="Search"
                    aria-label="Search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    autoFocus
                />
                <SearchIcon className="social_SearchPane_icon" aria-hidden />
            </div>
            <div className="social_SearchPane_tabs" role="tablist">
                {TABS.map(({ id, label }) => (
                    <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={tab === id}
                        className={`social_SearchPane_tab${tab === id ? " social_SearchPane_tab--active" : ""}`}
                        onClick={() => setTab(id)}
                    >
                        {label}
                    </button>
                ))}
            </div>
            <div role="tabpanel" className="social_SearchPane_results">
                {tab === "people" && <PeopleTab {...props} query={query} />}
                {tab === "groups" && <GroupsTab {...props} query={query} />}
                {tab === "posts" && <PostsTab {...props} query={query} />}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

function PeopleTab({ client, query, onViewUser }: Props & { query: string }): JSX.Element {
    const { people, loading } = usePeopleSearch(client, query);
    const [shownCount, setShownCount] = useState(PEOPLE_PAGE_SIZE);
    useEffect(() => setShownCount(PEOPLE_PAGE_SIZE), [query]);

    const hasMore = shownCount < people.length;
    const loadMore = useCallback(() => setShownCount((count) => count + PEOPLE_PAGE_SIZE), []);
    const sentinelRef = useLoadMoreSentinel(loadMore, hasMore);

    if (people.length === 0) {
        if (loading) return <Spinner />;
        return (
            <div className="social_ContentEmpty">
                <p>{query.trim() ? "No people match your search." : "You don't share a room with anyone yet."}</p>
            </div>
        );
    }

    return (
        <div className="social_SearchPane_people">
            {people.slice(0, shownCount).map((member) => (
                <SocialPersonRow key={member.userId} client={client} member={member} onViewUser={onViewUser} />
            ))}
            {hasMore && <div ref={sentinelRef} className="social_SearchPane_sentinel" />}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

const GROUP_ROOM_TYPES = new Set([MSC4501_ROOM_TYPE_GROUP as RoomType]);

function GroupsTab({ client, query, onViewRoom, onViewDirectoryGroup }: Props & { query: string }): JSX.Element {
    // false: always start on your own homeserver, without touching the server Spotlight remembers
    const { ready, loading, publicRooms, protocols, config, setConfig, search, error } = usePublicRoomDirectory(false);
    const debouncedQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);

    useEffect(() => {
        if (!ready || !config) return;
        void search({ limit: GROUPS_LIMIT, query: debouncedQuery || undefined, roomTypes: GROUP_ROOM_TYPES });
    }, [ready, config, debouncedQuery, search]);

    // The server already filtered on room type; this only guards against one that ignored it
    const groups = useMemo(
        () => publicRooms.filter((entry) => entry.room_type === MSC4501_ROOM_TYPE_GROUP),
        [publicRooms],
    );

    const onView = (entry: IPublicRoomsChunkRoom): void => {
        if (client.getRoom(entry.room_id)?.getMyMembership() === KnownMembership.Join) {
            onViewRoom(entry.room_id);
        } else {
            onViewDirectoryGroup(entry.room_id, config?.roomServer ? [config.roomServer] : []);
        }
    };

    let results: JSX.Element;
    if (loading && groups.length === 0) {
        results = <Spinner />;
    } else if (error) {
        results = (
            <div className="social_ContentEmpty">
                <p>Couldn't load groups from this server.</p>
            </div>
        );
    } else if (groups.length === 0) {
        results = (
            <div className="social_ContentEmpty">
                <p>{debouncedQuery ? "No groups match your search." : "This server lists no groups."}</p>
            </div>
        );
    } else {
        results = (
            <div className="social_GroupGrid">
                {groups.map((entry) => (
                    <DirectoryGroupTile key={entry.room_id} entry={entry} client={client} onView={onView} />
                ))}
            </div>
        );
    }

    return (
        <>
            <div className="social_SearchPane_server">
                <NetworkDropdown protocols={protocols} config={config ?? null} setConfig={setConfig} />
            </div>
            {results}
        </>
    );
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

/** Joined Social rooms (profiles and groups) - where posts are searched. */
function socialRoomIds(client: MatrixClient): string[] {
    return client
        .getRooms()
        .filter((room) => room.getMyMembership() === KnownMembership.Join && isSocialRoom(room))
        .map((room) => room.roomId);
}

/** Whether a search hit should be listed as a post: edits and reactions never are. */
function isPostResult(event: MatrixEvent): boolean {
    const relation = event.getWireContent()?.["m.relates_to"];
    return relation?.rel_type !== RelationType.Annotation && !event.isRelation(RelationType.Replace);
}

function PostsTab({
    client,
    query,
    pillsGeneration,
    onViewUser,
    onOpenUserPanel,
    onViewRoom,
    onOpenPost,
    onNavigateToProfile,
}: Props & { query: string }): JSX.Element {
    const term = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
    const [results, setResults] = useState<ISearchResults | null>(null);
    const [searching, setSearching] = useState(false);
    const [failed, setFailed] = useState(false);
    // Bumped when a like/reply changes a result, so its tile re-reads its state
    const [, setRevision] = useState(0);
    const requestId = useRef(0);

    useEffect(() => {
        const id = ++requestId.current;
        setResults(null);
        setFailed(false);
        if (!term) return;

        const rooms = socialRoomIds(client);
        const body = {
            search_categories: {
                room_events: {
                    search_term: term,
                    order_by: SearchOrderBy.Rank,
                    filter: { rooms },
                    event_context: { before_limit: 0, after_limit: 0, include_profile: true },
                },
            },
        };
        setSearching(true);
        client
            .search({ body })
            .then((response) =>
                client.processRoomEventsSearch({ _query: body, results: [], highlights: [] }, response),
            )
            .then(
                (processed) => {
                    if (id === requestId.current) setResults({ ...processed });
                },
                () => {
                    if (id === requestId.current) setFailed(true);
                },
            )
            .finally(() => {
                if (id === requestId.current) setSearching(false);
            });
    }, [client, term]);

    const loadMore = useCallback(() => {
        if (!results?.next_batch || searching) return;
        const id = requestId.current;
        setSearching(true);
        client
            .backPaginateRoomEventsSearch(results)
            .then(
                (processed) => {
                    if (id === requestId.current) setResults({ ...processed });
                },
                () => {},
            )
            .finally(() => {
                if (id === requestId.current) setSearching(false);
            });
    }, [client, results, searching]);
    const sentinelRef = useLoadMoreSentinel(loadMore, !!results?.next_batch && !searching);

    const highlights = useMemo(() => results?.highlights ?? [], [results?.highlights]);

    if (!term) {
        return (
            <div className="social_ContentEmpty social_SearchPane_prompt">
                <p>Search for posts using the search box above.</p>
            </div>
        );
    }
    if (failed) {
        return (
            <div className="social_ContentEmpty">
                <p>Couldn't search posts. Try again in a moment.</p>
            </div>
        );
    }
    if (!results) return <Spinner />;

    const myUserId = client.getSafeUserId();
    const posts = results.results
        .map((result) => result.context.getEvent())
        .filter(isPostResult)
        .map((event) => ({ event, room: client.getRoom(event.getRoomId()) }))
        .filter((post): post is { event: MatrixEvent; room: Room } => !!post.room);

    if (posts.length === 0) {
        return (
            <div className="social_ContentEmpty">
                <p>No posts match your search.</p>
            </div>
        );
    }

    return (
        <div className="social_Feed social_SearchPane_posts">
            {posts.map(({ event, room }) => {
                const eventId = event.getId()!;
                const reactions = room.relations.getChildEventsForEvent(
                    eventId,
                    RelationType.Annotation,
                    EventType.Reaction,
                );
                const myReactions = getMyReactions(reactions, myUserId) ?? [];
                const myLikeEventId = myReactions.find((e) => e.getContent()?.["m.relates_to"]?.key === "👍")?.getId();
                const isReposted = myReactions.some((e) => e.getContent()?.["m.relates_to"]?.key === "🔁");
                return (
                    <div key={eventId} className="social_Feed_item">
                        <SocialEventTile
                            event={event}
                            room={room}
                            isLiked={!!myLikeEventId}
                            isReposted={isReposted}
                            replyCount={replyCountFor(event, room, [[]])}
                            highlights={highlights}
                            pillsGeneration={pillsGeneration}
                            onRoomClick={onViewRoom}
                            onViewUser={onViewUser}
                            onOpenUserPanel={onOpenUserPanel}
                            onNavigateToProfile={onNavigateToProfile}
                            onViewThread={onOpenPost}
                            onLike={async () => {
                                if (myLikeEventId) await undoLike(client, room.roomId, myLikeEventId);
                                else await sendLike(client, room.roomId, eventId);
                                setRevision((r) => r + 1);
                            }}
                            onReply={async (body, file) => {
                                if (file) {
                                    await sendComment(client, room.roomId, body, eventId, file);
                                    return;
                                }
                                const result = await processSlashCommand(client, room.roomId, body);
                                if (!result.handled) {
                                    await sendComment(
                                        client,
                                        room.roomId,
                                        result.body,
                                        eventId,
                                        undefined,
                                        result.formattedBody,
                                        result.isEmote,
                                    );
                                }
                            }}
                        />
                    </div>
                );
            })}
            {results.next_batch && <div ref={sentinelRef} className="social_SearchPane_sentinel" />}
            {searching && <Spinner />}
        </div>
    );
}

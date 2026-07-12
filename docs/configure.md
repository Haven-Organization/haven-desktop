# Configuring Haven

`config.json` follows the same format as stock Element Web (see its own config docs) — nothing
Haven-specific changes that schema's shape. Any config option Haven itself adds lives under a
top-level `"haven": {}` block rather than a new top-level key, so a host can always tell what's
Haven-specific at a glance and strip that one block out if they ever move back to stock Element.

For build-time options (branding, login background, notification sound), see
[building.md](building.md) instead — those aren't set in `config.json`.

## Disabling apps

```json
"haven": {
    "apps": {
        "enabled": false
    }
}
```

turns off every Haven app. To turn off just specific ones instead, use their app id (the same id
each app already uses internally — matches its directory name under `src/apps/`):

| App | id |
| --- | --- |
| Social | `social` |

```json
"haven": {
    "apps": {
        "social": { "enabled": false }
    }
}
```

## Blockquote style

A message line starting with `> ` renders as stock Element's normal blockquote (a bordered,
indented block) by default. Set this to have it render as greentext instead — the imageboard/
fediverse style: plain green text, no border or indent.

```json
"haven": {
    "blockquote_style": "greentext"
}
```

## Native Social post event type

```json
"features": {
    "feature_msc4501_native_post_type": "enable"
}
```

Off by default. When on, Social sends new posts as the native `org.matrix.msc4501.social.post`
event type (see [MSC4501](https://github.com/matrix-org/matrix-spec-proposals/pull/4501)) instead
of wrapping them in `m.room.message`. Leave this off unless every client your users actually use to
read Social already understands the native type — a client that doesn't will just show nothing for
those posts.

Deliberately host-only: this is left out of the Labs page (Settings > Labs) that Element's own
`show_labs_settings`/`features` mechanism would otherwise expose it through, since flipping it on
per-device would silently break reading Social for anyone still on a client that doesn't understand
the native event type yet - this is meant to be a considered, whole-deployment decision by whoever
runs the homeserver/build, not a casual per-user toggle. Still fully controlled by the `features`
block above regardless.

## Removing the login/register footer links

Not Haven-specific, but worth knowing about since Haven's own default footer link differs from
stock Element's: this is stock config.json's own `branding.auth_footer_links` field, which fully
replaces the footer's links (including "Powered by Matrix").

```json
"branding": {
    "auth_footer_links": []
}
```

removes them entirely. Give it your own list instead of `[]` to replace them rather than remove
them:

```json
"branding": {
    "auth_footer_links": [
        { "text": "Blog", "url": "https://example.com/blog" }
    ]
}
```

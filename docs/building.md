# Building

## Web

```
cd element-web/apps/web
pnpm dist
```

This produces a static build. For local development with hot reload, use `pnpm start` instead.

## Desktop

The desktop app is a thin Electron wrapper around the same web app, so build the web app first,
then link it in and build the desktop package:

```
cd element-web/apps/web
pnpm dist

cd ../desktop
ln -s ../web/webapp ./webapp
pnpm build
```

The packaged app for your operating system ends up in `element-web/apps/desktop/dist/`.

## Build options

### Web (and shared by desktop, since desktop wraps the web build)

Set these as environment variables before `./scripts/setup.sh`. All are optional — a plain
`./scripts/setup.sh` with none of them gives you Haven's own default branding.

- `HAVEN_NO_BRANDING=1` — revert to stock Element's own logos/icons/background/brand name/footer
  link instead of Haven's. Not a `config.json` option on purpose: that would mean always packaging
  both asset sets in every build just for a rarely-used switch, instead of a build simply having
  the one it was built with.
- `HAVEN_LOGIN_BACKGROUND=/path/to/image` — bake in a custom login screen background, replacing
  whichever set of default branding you chose above. Genuinely optional even if you want a custom
  background at all — `config.json`'s own stock `branding.welcome_background_url` field already
  accepts any URL, including one hosted elsewhere, with no build changes needed. Use this only if
  you'd rather bake the image into the build itself.
- `HAVEN_NOTIFICATION_SOUND=/path/to/sound.mp3` (optionally with
  `HAVEN_NOTIFICATION_SOUND_OGG=/path/to/sound.ogg`) — bake in a custom default notification sound,
  replacing the one played when nobody's set their own custom sound (Settings > Notifications). If
  only the `.mp3` is given, the stock `.ogg` is left in place as a fallback for the rare browser
  that can't play mp3.

There's no build-time option for the login/register footer links (customizing or removing them
entirely) or for disabling apps - both are `config.json` options instead, see
[configure.md](configure.md).

Set this as an environment variable before `pnpm dist` (inside `element-web/apps/web`) specifically,
not before `setup.sh`:

- `DIST_VERSION=1.2.3` — use this exact string as the build's version instead of the one
  `scripts/compute-haven-version.sh` would otherwise compute (`haven-v<haven-version>+element-
  <element-version>[_<code-hash>]` - see that script's own comments). Also names the output tarball
  (`dist/<version>.tar.gz`). Useful for CI pipelines that want a version scheme of their own, or for
  reproducing an exact previous build's version string.

### Desktop only

- `VARIANT_PATH=element.io/release/build.json` (relative to `element-web/apps/desktop`) — build with
  a different desktop identity (app name, app id, protocol handlers) instead of Haven's own default
  (`haven/release/build.json`). `element.io/release/build.json` and `element.io/nightly/build.json`
  ship with the desktop app already, giving you a build that identifies as stock Element instead of
  Haven at the OS level (taskbar name, protocol registration, etc.) - the desktop-specific
  counterpart to `HAVEN_NO_BRANDING` above, which only covers the web app's own visual assets, not
  the desktop package's own metadata.

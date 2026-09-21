HavenPistol-colr.woff2

A one-glyph COLRv0 emoji font containing only U+1F52B (pistol). Used by
res/themes/light/css/_fonts.pcss to override that single codepoint in the
bundled "Twemoji" family.

Artwork: Twemoji, (c) Twitter, Inc and other contributors, licensed under
CC-BY 4.0 (https://creativecommons.org/licenses/by/4.0/).
Source: https://github.com/twitter/twemoji/blob/a6f943b95/assets/svg/1f52b.svg
(commit a6f943b95, "update emojis (#1454)", 2026-01-10 - on master, not in a
tagged release).

Rebuilt with nanoemoji (glyf_colr_0, upem 512, width 512, ascender 448,
descender -64 - which reproduces how the bundled Twemoji Mozilla font places
Twemoji's 36x36 art), then with hhea/OS/2 vertical metrics copied from
TwemojiMozilla-colr.woff2 so lines using it don't change height.

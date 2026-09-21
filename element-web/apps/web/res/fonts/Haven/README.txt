HavenHandgun-colr.woff2, HavenRevolver-colr.woff2

One-glyph COLRv0 emoji fonts, each containing only U+1F52B (the gun emoji). Used by
res/themes/light/css/_fonts.pcss as the "Haven Handgun" and "Haven Revolver" font families, which
FontWatcher puts ahead of the bundled "Twemoji" family in the emoji font stack according to the
"Haven.gunEmojiStyle" setting. (The third option, Water Pistol, is what the bundled Twemoji Mozilla
font already draws, so it needs no font of its own.)

Artwork: Twemoji, (c) Twitter, Inc and other contributors, licensed under CC-BY 4.0
(https://creativecommons.org/licenses/by/4.0/).
  Handgun:  https://github.com/twitter/twemoji/blob/a6f943b95/assets/svg/1f52b.svg
            (commit a6f943b95, "update emojis (#1454)", 2026-01-10 - on master, not in a tagged
            release)
  Revolver: https://github.com/twitter/twemoji/blob/8b6c9d853/2/svg/1f52b.svg
            (commit 8b6c9d853, "Twemoji 2.5 update", 2018-02-23 - the last revision before the
            April 2018 switch to a water pistol in 2.6)

Rebuilt with nanoemoji (glyf_colr_0, upem 512, width 512, ascender 448, descender -64 - which
reproduces how the bundled Twemoji Mozilla font places Twemoji's 36x36 art), then with hhea/OS/2
vertical metrics copied from TwemojiMozilla-colr.woff2 so lines using them don't change height, the
stray U+0020 mapping nanoemoji adds removed, and the attribution written into each font's name table:

    nanoemoji --color_format glyf_colr_0 --family "Haven Handgun" --upem 512 --width 512 \
        --ascender 448 --descender -64 --output_file HavenHandgun.ttf svg/emoji_u1f52b.svg

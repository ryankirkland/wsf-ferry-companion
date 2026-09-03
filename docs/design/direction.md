# Design Direction: Paper Sound

Locked 2026-07-24 (ADR-0002). Source of truth for tokens, map visual language,
and voice. Judged against live prototypes: `moodboards/paper-sound.html`
(identity) and `moodboards/paper-sound-map.html` (real-geography proof).
Parked polish lives in [delights.md](delights.md) - never block a milestone on it.

## The idea

Cut-paper warmth on real geography. Flat layered color, soft paper shadows,
one confident ferry green, grain instead of gloss. Whimsy comes from the cut
edges, the boats, and the words; cleanliness from flatness and restraint.
The map is the product's soul and must stand alone as ambient wall art,
adapting to Puget Sound's actual day, dusk, and night.

## Color tokens

CSS custom properties; the map applies the same values to basemap layers at
runtime. Day is the reference; dusk and night are full palettes, not filters.

| Token | Day | Dusk | Night | Use |
|---|---|---|---|---|
| `--land` | `#efe9db` | `#e8d7bd` | `#131f26` | basemap land / page background tint base |
| `--green` | `#c9d5b5` | `#bcc4a0` | `#17281f` | parks, woods |
| `--water` | `#74a8b0` | `#587b92` | `#1f3a46` | the Sound |
| `--waterway` | `#8db8be` | `#6f8ea2` | `#27444f` | rivers, minor water |
| `--road` | `#ddd5c2` | `#d4c3a5` | `#20303a` | minor roads (texture, not information) |
| `--road-major` | `#d3c9b2` | `#c8b696` | `#273a45` | highways |
| `--ink` | `#26333a` | `#3a3a30` | `#dbe6e2` | text, labels |
| `--ink-soft` | `#5d6d75` | `#5d5d4d` | `#9fb3ad` | secondary text |
| `--halo` | `#f2efe9` | `#eee0c6` | `#131f26` | label halos |
| `--water-text` | `#33606a` | `#3e5a6e` | `#6f98a2` | water-body labels |
| `--paper` | `#f6f3ec` | `#f0e4cf` | `#101a21` | app page background |
| `--card` | `#ffffff` | `#f9f1e2` | `#1a2830` | cards |
| `--card-line` | `#e2ddd0` | `#d9cbb2` | `#26363f` | card borders/dividers |
| `--accent` | `#007b5f` | `#0a6b55` | `#2fae8a` | THE ferry green: actions, emphasis, charts |
| `--hill-shadow` | `#a3947a` | `#87735c` | `#070e13` | hillshade shadows (exaggeration .28/.30/.35) |
| `--hill-light` | `#fdf9ee` | `#f8e8ca` | `#1e3944` | hillshade highlights |

Vessel sprite: hull `#fffdf6` / `#f6ecd9` / `#d9d3c2` · cabin `#007b5f` /
`#0a6b55` / `#0e5544` · windows `#eaf3ef` / `#ffcf7a` / `#ffcf7a` (windows go
amber the moment dusk begins - the lantern moment is the brand) · stack
`#e5674b` / `#d05a40` / `#8f4433` · wake `#26737b` / `#4c6f84` / `#7fd8b8`.

Status colors (reserved, never decorative): ontime `#dff0e6`/`#106648` ·
delay `#fce8cf`/`#8a5310` · boarding `#e3eaf9`/`#33508f` · alert edge `#e8a13c`.
The pill-less warning pair rides the modes, because it is small text painted
straight onto `--card` with no tinted background to lean on: warn `#96691f` /
`#90651e` / `#bc8327` · alarm `#bb5742` / `#ad523b` / `#b48276`, each tuned to
at least 4.6:1 on that mode's card (added 2026-08-30 for the drive-up counts;
the fixed status pair above is measured against its own `-bg`, which is why it
can be mode-independent).
Grain: canvas-baked speckle, dark `rgba(38,51,58,.06)` on day/dusk, light
`rgba(255,255,255,.05)` at night, ~55% coverage, tiled 96px.

## Type

- **Gabarito** (500-800): display, headings, numbers, vessel/terminal labels.
- **Inter** (400-700): body, UI, captions.
- Labels on the map: Gabarito 700, uppercase, tracked `.10-.16em`, always haloed.
- Scale: display `clamp(2.2rem,5vw,3.4rem)/800` · h2 `2rem/700` · card title
  `1.25rem/700` · body `1rem/1.55` · caption `.85rem` · micro `.72rem/700 upper`.
- Map-rendered basemap labels keep engine fonts for now; Gabarito glyph
  conversion is a delight, not a blocker.

## Map visual language

- **Stack:** MapLibre GL + vector tiles (OpenFreeMap in prototypes), basemap
  recolored to tokens at runtime; hillshade from open terrain data under the
  water layer; grain sheet over paint, under labels; buildings/POI/transit
  hidden; basemap town names suppressed for our five terminal towns.
- **Vessel states (honesty is a feature):**
  - *Underway* - sprite + wake, name beneath. Wake only while moving.
  - *At dock / dwelling* - no wake, "at dock", holds just offshore of the label.
  - *Out of service / yard* - 62% opacity, plain-language note ("resting ·
    back 2:05 pm"), parked at Eagle Harbor. Never hidden, never "sailing".
  - *Stale data* (source older than 5 min) - desaturated + "as of h:mm".
    Stale is a state, not an error.
- **Terminals:** rounded-square dot + tracked-caps label; west-shore labels
  extend left, east-shore right; Eagle Harbor styled soft.
- **Routes:** dotted ink lines at ~45% opacity, terminal to terminal.
- **Declutter:** below zoom ~10.2 vessel names/states and soft labels hide;
  sprites and terminal names carry the scene.
- **Motion:** rAF glide with dock dwells; `prefers-reduced-motion` renders a
  static scene; ambient mode re-measures and re-frames on resize/visibility.
- **Modes:** day / dusk / night switched on real Puget Sound time (auto), with
  manual override. Everything re-tints: basemap, hillshade, grain, sprites, UI.

## Voice

Warm, brief, concrete, never cutesy about people's time.
- Delay: "Wenatchee is running 12 minutes behind. The 6:20 just became the smart choice."
- Empty: "That was the last boat tonight. First one out tomorrow is 4:45 AM."
- Loading: the map's own vessel sprite sketched on stroke by stroke - hull,
  cabin, windows, stack, wake - then filled in the mode tokens until it is the
  map's boat exactly, looping until the map is up (`LoadingFerry`,
  2026-09-01). "Talking to the Sound..." stays as its accessible name (it is
  an image, not a live region); reduced-motion users get the finished boat.
- Numbers are honest: percentiles over means, denominators stated, cancellations never hidden.

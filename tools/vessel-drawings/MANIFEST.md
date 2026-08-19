# WSDOT class-drawing mirror manifest

Mirrored 2026-07-31 (re-run 2026-08-18 to add the transparent variants)
from `Class.DrawingImg` in `/vessels/rest/vesselverbose`. Re-run and
re-upload if WSF commissions a new vessel class (about once a decade -
the newest here is Kwa-di Tabil, 2010):

```bash
uv run tools/vessel-drawings/mirror-drawings.py --upload \
  --bucket wsf-prod-map-assets-654654574183
```

Serving paths: `https://ferrysound.com/assets/vessels/<slug>.png` (white
plate, the vessel card; published into `/data/vessels.json` as each
vessel's `drawing` field) and `<slug>-t.png` (transparent background,
the map markers - the frontend derives the `-t` URL from `drawing`).

The images are NOT committed (`mirror/` is gitignored), same as
`tools/map-assets/mirror/`: WSDOT artwork stays out of a public repo, and
the shasums below are the integrity record.

## Two variants, two grounds

The **card** keeps the white plate: these are dark line drawings made
for white paper, and against a dusk or night card the linework would
disappear - the plate is also how WSDOT presents them.

The **map** uses the transparent variant (owner's call after an A/B
against the vector-traced icons, 2026-08-18: the drawings' detail wins).
The extraction is a border-connected flood fill, NOT a global white
filter - whites inside the hull (superstructure panels, deck faces) are
part of the drawing and survive; only page background connected to the
image border becomes alpha, with near-white edge pixels feathered. Night
mode tames the white superstructure with a brightness filter in the map
CSS; the traced svg icons remain the fallback for a class without a
drawing or a failed load.

## Slugs come from ClassName, never PublicDisplayName

`Issaquah` and `Issaquah 130` both display as "Issaquah" and have
different drawings; keying on the display name silently merges two
classes. `wsf_core.vessel_classes.class_slug` is the single source shared
by the mirror script and the published dim.

## Classes

| class | slug | bytes | sha256 |
|---|---|---|---|
| Evergreen State | `evergreen-state` | 19,195 | `bcd7488e90e72b6f…` |
| Issaquah | `issaquah` | 21,612 | `41176f03e1f08b55…` |
| Issaquah 130 | `issaquah-130` | 23,025 | `8d247b263a2d1f2e…` |
| Jumbo | `jumbo` | 18,850 | `6090e245fe47a031…` |
| Jumbo Mark II | `jumbo-mark-ii` | 27,608 | `6ab411e69c404e05…` |
| Kwa-di Tabil | `kwa-di-tabil` | 33,587 | `8f33bdbaccf2356e…` |
| Olympic | `olympic` | 38,954 | `69c7df4ac5c1adae…` |
| Super | `super` | 22,377 | `61ec40ef065a8ff7…` |

Full shasums:

```
bcd7488e90e72b6fdf6bb13106a8d1a675abebcd198665cefb7b342f8c191861  evergreen-state.png
41176f03e1f08b552a7bda187288ba2a6b223216162382e7823420da47611f39  issaquah.png
8d247b263a2d1f2e5c13c9696db1a16f74dc6d99c664e97758df3ce66c48d897  issaquah-130.png
6090e245fe47a031e373948f9704ef8f36643b16cac32d694f2643dc8d8e980d  jumbo.png
6ab411e69c404e05f1c4fb9fde7f0834fc38ec92b616045d071078573cc53f94  jumbo-mark-ii.png
8f33bdbaccf2356e4be606a2d8df373726cdafe7edc7b78d0bbfd1e62c045ca5  kwa-di-tabil.png
69c7df4ac5c1adae29be61edaa65c0860d4c6f5f1a41ada2f0eb93eba0fd6634  olympic.png
61ec40ef065a8ff74751a0ecc9abaa77fd7893b2de6fc87b44751119d1a3a14e  super.png
fedeab5cdd34afc96b003a50d8594c93cb1fb26aba2c6b047cd58bd1fc14fe43  evergreen-state-t.png
ed5e4dfd3246581616a3030ce595c74c6381d954db69834b66f4bb4cd60f2368  issaquah-t.png
41136249d01b2899ab9df0da29809e6d190b2506c08fcf9d65104b753f5b0e82  issaquah-130-t.png
60fb2fea48c3c660b691691c803906fc9e36d24abdaf0434784dd6c6415872e9  jumbo-t.png
d76570253c00df3b91fda256ade09ab0ce1c1233a912bb83555e974c349f59cb  jumbo-mark-ii-t.png
592a3f1b77ac7b42825669ab15ca7be0ef9728c5501a711929ffab85d2fd6ddc  kwa-di-tabil-t.png
0d6cc11ee3cbed55fb83508f0c70d0719901a775e852dca9e0d73b87be06beaf  olympic-t.png
475216c19afd240aa94d3c5c2a87188ff6a14f43caff46f25bb3b1ed39c176a2  super-t.png
```

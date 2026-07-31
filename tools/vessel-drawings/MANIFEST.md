# WSDOT class-drawing mirror manifest

Mirrored 2026-07-31 from `Class.DrawingImg` in
`/vessels/rest/vesselverbose`. Re-run and re-upload if WSF commissions a
new vessel class (about once a decade - the newest here is Kwa-di Tabil,
2010):

```bash
uv run tools/vessel-drawings/mirror-drawings.py --upload \
  --bucket wsf-prod-map-assets-654654574183
```

Serving path: `https://ferrysound.com/assets/vessels/<slug>.png`, published
into `/data/vessels.json` as each vessel's `drawing` field.

The images are NOT committed (`mirror/` is gitignored), same as
`tools/map-assets/mirror/`: WSDOT artwork stays out of a public repo, and
the shasums below are the integrity record.

## Why the background stays white

These are dark line drawings made for white paper. Knocking the
background out would erase the hull outline, rails and lettering against a
dusk or night card, so the card gives them a light plate instead. The
processing step only crops surrounding page-white to the drawing's
bounding box.

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
```

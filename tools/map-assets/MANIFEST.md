# Map asset mirror manifest

Mirrored from the OpenFreeMap public instance on 2026-07-29 (ADR-0003:
self-hosted glyphs/sprites/style from day one). Re-run the three scripts
and re-sync if the provider or style generation ever changes.

- Glyphs: 3 fontstacks (Noto Sans Regular/Bold/Italic) x 256 ranges = 768 files -> s3://wsf-prod-map-assets-*/assets/fonts/
- Sprites: ofm_f384 set (4 files) -> assets/sprites/ofm_f384/
- Style: dist/positron-v1.json (committed) -> assets/style/positron-v1.json; 55 layers, ne2_shaded dropped, glyphs/sprite rewritten to ferrysound.com

## shasums
```
7ef35987d0433f778c5bb08cae6397dbcc0a70cd30e7383e6aa66eb8fa29396d  dist/positron-v1.json
73e75e58d8c7bb62cc25d9d150660500552f4d04f6eac5efa4e236076773c356  mirror/sprites/ofm_f384/ofm.json
8996a519d218dc5f98015267709dae272a77bb74ef0ecc5a0992dcf276c1be4c  mirror/sprites/ofm_f384/ofm.png
82a4aaeed2c5ce6e98553915754dbe394ee66fd9a2aacc4318d25cdd74e8730b  mirror/sprites/ofm_f384/ofm@2x.json
3793faf7dc47960636e4b6b1039978fa6925e6c90a7cb49ef23b37e153635c9b  mirror/sprites/ofm_f384/ofm@2x.png
```

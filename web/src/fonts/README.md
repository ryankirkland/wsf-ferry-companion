# Self-hosted fonts

`roboto-latin-wght-normal.woff2` - Roboto (variable weight 100-900, latin
subset), from Google Fonts (fonts.gstatic.com, Roboto v51), SIL Open Font
License 1.1. Loaded once in `src/app/layout.tsx` as `--font-sans`; the only
UI and map-label family per ADR-0008. Basemap labels drawn by MapLibre use
the glyph PBFs under `/assets/fonts`, not this file.

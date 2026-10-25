# ADR-0008: Roboto for all type; non-map UI moves to the Fog layout

- **Status:** Accepted (2026-10-25)
- **Supersedes:** the Type section of ADR-0002 (Gabarito + Inter). The rest of
  ADR-0002 - Paper Sound colors, the three modes, the map's visual language -
  stands unchanged.
- **Context:** Ryan wanted the non-map UI (trip page, vessel card, alerts,
  stats, account) polished enough to be a portfolio showcase. A design canvas
  explored ten directions; the review settled on the **Fog** layout (soft
  white cards on the page ground, sentence headlines, countdown-first trip
  cards) rendered in the **existing Paper Sound colors**, and on **Roboto** for
  type after comparing nine sans-serif options side by side on the same
  mobile board. Canvas: https://claude.ai/artifact/85Vaoyr3BrsyrNHR5qXFa8
  (private; pages "Tidegauge x6" and "Type options").

## Decision

1. **One typeface, Roboto,** for every surface: UI, headings, numbers and the
   HTML map labels (terminal names, weather chips). Self-hosted as one
   variable woff2 (weight 100-900, latin subset, 37 KB) via `next/font/local`
   as `--font-sans`. Basemap labels drawn by MapLibre keep their glyph PBFs.
2. **Colors do not change.** The Fog layout uses the Paper Sound tokens as
   they are, so dusk and night keep working everywhere with no new palette.
3. **Fog layout rules** for the non-map UI, applied in follow-up changes:
   - The card shown when a boat is tapped is a *trip* card: route and arrival
     lead; the boat's name, class and capacity are a one-line footnote; the
     WSDOT class drawing stays (photos exist for only some boats).
   - Sentence headlines ("Leaves Seattle in 59 minutes"); a "Now" divider in
     departure lists; a late departure shows the actual time with the
     scheduled time struck through.
   - No all-caps or mono eyebrow labels; sentence case only.
   - The accent green is the single action color (buttons, active nav, menu
     and map-control icons); ink is for text.
   - A route with no alerts shows one quiet "No alerts on this route" line,
     never other routes' alerts.
   - The mobile bottom menu matches the page background.

## Alternatives considered

- **Full Fog palette** (fog gray-green ground, sea-glass teal accent): the
  look Ryan first picked. Rejected in favor of Paper Sound colors because it
  needed a second color system with its own night and dusk palettes, would
  have split the UI from the map it sits on, and the side-by-side showed the
  Fog *layout* carried the improvement, not its colors.
- **Keep Gabarito + Inter:** zero migration, and Gabarito has more
  personality. Rejected: two families for one product, 82 KB of fonts versus
  37 KB, and in the side-by-side Roboto read cleaner at small sizes.
- **Helvetica Neue / Arial (system fonts):** zero download, but Helvetica Neue
  only exists on Apple devices and Arial is missing on most Android phones, so
  most riders would see a fallback rather than the chosen face.
- **Commercial faces (e.g. Albra Grotesk):** a paid web license to track for a
  side project; not worth it over an open font.

## Consequences

- Roboto is Android's system font, so many riders already have it and the
  site looks native there.
- The map's uppercase tracked terminal labels keep their style in Roboto 700.
- `docs/design/direction.md` Type section now points here.

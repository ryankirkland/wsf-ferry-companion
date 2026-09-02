# PMTiles fallback runbook (ADR-0003, amended)

The tested escape hatch from the donation-funded OpenFreeMap public
instance. Nothing links to `/tiles/*`; promotion is one env change + a
site rebuild.

## Why Planetiler, not `pmtiles extract` (the ADR-0003 amendment)

ADR-0003 originally said "pmtiles extract against the daily planet build" -
but the Protomaps planet build uses the **Protomaps basemap schema**, while
our forked positron style (and every recolor heuristic proven against it)
expects the **OpenMapTiles schema**. Extracted Protomaps tiles would render
garbage. **Planetiler** generates OpenMapTiles-schema PMTiles - the same
toolchain OpenFreeMap itself uses - so the style fork works unchanged. Same
S3 + Lambda + CloudFront pattern and cost posture as the ADR.

## Build the archive (local, ~45 min; refresh monthly-ish)

```bash
brew install openjdk   # once
cd tools/pmtiles
curl -LO https://github.com/onthegomap/planetiler/releases/latest/download/planetiler.jar
java -Xmx4g -jar planetiler.jar --download --area=washington \
  --output=wa.pmtiles
# Output ~1-1.5 GB, z0-14, OpenMapTiles schema, Geofabrik WA extract.
# Key MUST be tiles/wa.pmtiles: CloudFront forwards the full /tiles/wa/...
# path and the Lambda's greedy name parse resolves the archive as
# "tiles/wa" (verified live 2026-07-29).
aws s3 cp wa.pmtiles s3://wsf-prod-tiles-654654574183/tiles/wa.pmtiles --profile ryan
```

## Vendor the Protomaps Lambda (once per upstream release)

```bash
cd tools/pmtiles
# The official AWS deployment bundle from the PMTiles repo releases:
gh release download --repo protomaps/PMTiles --pattern "*lambda*.zip" --dir dist/
mv dist/*lambda*.zip dist/lambda.zip
```

(If the artifact name changes upstream, check
https://docs.protomaps.com/deploy/aws for the current bundle.)

## Deploy

`infra/modules/tiles-fallback` (bucket + Lambda + Function URL) is wired in
`envs/prod`; the static-site module adds the `/tiles/*` behavior when
`tiles_origin_domain` is set. Standard PR -> plan -> merge -> apply.

## Switch test (record results here)

```bash
cd tools/map-assets && node build-style.mjs --selfhost
aws s3 cp dist/positron-selfhost-v1.json \
  s3://wsf-prod-map-assets-654654574183/assets/style/positron-selfhost-v1.json \
  --content-type application/json --cache-control "public, max-age=31536000, immutable" --profile ryan
cd ../../web
NEXT_PUBLIC_STYLE_URL=https://soundferries.com/assets/style/positron-selfhost-v1.json pnpm dev
# 1. Playwright smoke against the dev server
# 2. Manual visual parity pass: day / dusk / night
# 3. Record tile p50 latency from the network panel below
```

| Date | Result | Tile p50 | Notes |
|---|---|---|---|
| 2026-07-29 | PASS - visual parity in night mode, boats + labels + declutter identical | 0.16 s warm / 0.89 s cold (z10-z12 probes) | Archive 0.29 GB; first probe 404ed until the tiles/ key prefix fix |

Promotion, if ever needed: set `NEXT_PUBLIC_STYLE_URL` in web-deploy.yml,
rebuild, done.

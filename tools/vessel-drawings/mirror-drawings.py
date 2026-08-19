# /// script
# requires-python = ">=3.12"
# dependencies = ["pillow>=10", "boto3>=1.34", "httpx>=0.27"]
# ///
"""Mirror WSDOT's official per-class ferry drawings into the map-assets
bucket, the same way tools/map-assets mirrors glyphs and sprites.

Why mirror at all: the URLs in vesselverbose point at wsdot.wa.gov, so
hotlinking would make a vessel card depend on their server and leak a
request per view. Same reasoning as ADR-0003 for tiles.

Why a script and not the dims Lambda: WSF commissions a vessel class about
once a decade. A 15-minute Lambda carrying Pillow to re-check eight
unchanging GIFs is machinery for an event that has not happened since the
Kwa-di Tabil class in 2010.

The drawings are NOT committed (mirror/ is gitignored) - only this script
and the manifest, which is the tools/map-assets convention and keeps
WSDOT artwork out of a public repo.

Usage:
  uv run tools/vessel-drawings/mirror-drawings.py            # download + process
  uv run tools/vessel-drawings/mirror-drawings.py --upload   # + push to S3
"""

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path

import boto3
import httpx
from PIL import Image

# Load the slug helper by path: importing the package would drag in the
# API client and pydantic for a two-line function, but duplicating it here
# would let the script and the published dim drift apart.
_slug_module = importlib.util.spec_from_file_location(
    "wsf_core_vessel_classes",
    Path(__file__).resolve().parents[2] / "libs/wsf-core/src/wsf_core/vessel_classes.py",
)
_vessel_classes = importlib.util.module_from_spec(_slug_module)
_slug_module.loader.exec_module(_vessel_classes)
class_slug = _vessel_classes.class_slug

HERE = Path(__file__).parent
MIRROR = HERE / "mirror"
BUCKET_PREFIX = "assets/vessels/"
# Room to breathe around the hull once the surrounding page-white is cropped.
MARGIN_PX = 6


def fetch_classes(access_code: str) -> dict[str, str]:
    """ClassName -> drawing URL. Keyed on ClassName, never the public display
    name: "Issaquah" and "Issaquah 130" both display as "Issaquah" and have
    different drawings, so display names would collide two classes into one."""
    url = "https://www.wsdot.wa.gov/ferries/api/vessels/rest/vesselverbose"
    rows = httpx.get(url, params={"apiaccesscode": access_code}, timeout=30).json()
    classes: dict[str, str] = {}
    for row in rows:
        block = row.get("Class") or {}
        name, drawing = block.get("ClassName"), block.get("DrawingImg")
        if name and drawing:
            classes[name] = drawing
    return classes


def process(raw: bytes) -> bytes:
    """GIF -> PNG, cropped to the drawing.

    The background stays WHITE on purpose. These are technical drawings in
    dark linework: knock the white out and the hull outline, deck rails and
    lettering disappear against a dark card. The card gives them a light
    plate instead, which is also how WSDOT presents them.
    """
    from io import BytesIO

    image = Image.open(BytesIO(raw)).convert("RGB")
    # Crop to non-white content, then re-pad evenly.
    mask = image.point(lambda v: 255 if v < 250 else 0).convert("L")
    box = mask.getbbox()
    if box:
        left, top, right, bottom = box
        image = image.crop(
            (
                max(0, left - MARGIN_PX),
                max(0, top - MARGIN_PX),
                min(image.width, right + MARGIN_PX),
                min(image.height, bottom + MARGIN_PX),
            )
        )
    out = BytesIO()
    image.save(out, format="PNG", optimize=True)
    return out.getvalue()


# Page-white threshold for the transparent variant; the linework is far darker.
WHITE_T = 243


def transparent(png: bytes) -> bytes:
    """The map variant: page background knocked out, drawing kept intact.

    Border-connected flood fill, NOT a global white filter - the whites
    INSIDE the hull (superstructure panels, deck faces) are part of the
    drawing and must survive. Chosen for the map after an A/B against the
    traced vector icons (2026-08-18, owner's call: the drawings' detail
    wins). The white-plate original above remains the card's version.
    """
    from collections import deque
    from io import BytesIO

    image = Image.open(BytesIO(png)).convert("RGBA")
    w, h = image.size
    px = image.load()

    def whiteish(x: int, y: int) -> bool:
        r, g, b, _ = px[x, y]
        return r >= WHITE_T and g >= WHITE_T and b >= WHITE_T

    seen = [[False] * w for _ in range(h)]
    queue: deque[tuple[int, int]] = deque()
    for x in range(w):
        for y in (0, h - 1):
            if whiteish(x, y) and not seen[y][x]:
                seen[y][x] = True
                queue.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if whiteish(x, y) and not seen[y][x]:
                seen[y][x] = True
                queue.append((x, y))
    while queue:
        x, y = queue.popleft()
        px[x, y] = (0, 0, 0, 0)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and whiteish(nx, ny):
                seen[ny][nx] = True
                queue.append((nx, ny))

    # Soften the cut: near-white pixels touching transparency get alpha
    # proportional to how far from white they are, so the hull edge does
    # not alias hard against the water.
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            touching = any(
                0 <= nx < w and 0 <= ny < h and px[nx, ny][3] == 0
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1))
            )
            if touching and min(r, g, b) > 190:
                px[x, y] = (r, g, b, max(0, 255 - min(r, g, b)))

    out = BytesIO()
    image.save(out, format="PNG", optimize=True)
    return out.getvalue()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--upload", action="store_true", help="push to the map-assets bucket")
    parser.add_argument("--bucket", default=os.environ.get("MAP_ASSETS_BUCKET"))
    args = parser.parse_args()

    access_code = os.environ.get("WSF_ACCESS_CODE")
    if not access_code:
        raise SystemExit("WSF_ACCESS_CODE not set (it lives in .env)")

    MIRROR.mkdir(exist_ok=True)
    classes = fetch_classes(access_code)
    print(f"{len(classes)} vessel classes with drawings")

    manifest = []
    for name, url in sorted(classes.items()):
        slug = class_slug(name)
        raw = httpx.get(url, timeout=30, follow_redirects=True).content
        png = process(raw)
        png_t = transparent(png)
        (MIRROR / f"{slug}.png").write_bytes(png)
        (MIRROR / f"{slug}-t.png").write_bytes(png_t)
        manifest.append(
            {
                "class": name,
                "slug": slug,
                "source": url,
                "bytes": len(png),
                "sha256": hashlib.sha256(png).hexdigest(),
                "bytes_t": len(png_t),
                "sha256_t": hashlib.sha256(png_t).hexdigest(),
            }
        )
        print(f"  {name:16} -> {slug}.png {len(png):,}b / {slug}-t.png {len(png_t):,}b")

    (MIRROR / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")

    if args.upload:
        if not args.bucket:
            raise SystemExit("--upload needs --bucket or MAP_ASSETS_BUCKET")
        s3 = boto3.client("s3")
        for entry in manifest:
            for suffix in ("", "-t"):
                key = f"{BUCKET_PREFIX}{entry['slug']}{suffix}.png"
                s3.put_object(
                    Bucket=args.bucket,
                    Key=key,
                    Body=(MIRROR / f"{entry['slug']}{suffix}.png").read_bytes(),
                    ContentType="image/png",
                    # Drawings change when a class is commissioned; a day of edge
                    # caching costs nothing and a rebuild busts it by content.
                    CacheControl="public, max-age=86400",
                )
                print(f"  uploaded {key}")

    print("\nManifest shasums:")
    for entry in manifest:
        print(f"  {entry['sha256']}  {entry['slug']}.png")
        print(f"  {entry['sha256_t']}  {entry['slug']}-t.png")


if __name__ == "__main__":
    main()

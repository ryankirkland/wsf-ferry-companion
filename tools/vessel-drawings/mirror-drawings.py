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
        path = MIRROR / f"{slug}.png"
        path.write_bytes(png)
        manifest.append(
            {
                "class": name,
                "slug": slug,
                "source": url,
                "bytes": len(png),
                "sha256": hashlib.sha256(png).hexdigest(),
            }
        )
        print(f"  {name:16} -> {slug}.png  {len(png):,}b")

    (MIRROR / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")

    if args.upload:
        if not args.bucket:
            raise SystemExit("--upload needs --bucket or MAP_ASSETS_BUCKET")
        s3 = boto3.client("s3")
        for entry in manifest:
            s3.put_object(
                Bucket=args.bucket,
                Key=f"{BUCKET_PREFIX}{entry['slug']}.png",
                Body=(MIRROR / f"{entry['slug']}.png").read_bytes(),
                ContentType="image/png",
                # Drawings change when a class is commissioned; a day of edge
                # caching costs nothing and a rebuild busts it by content.
                CacheControl="public, max-age=86400",
            )
            print(f"  uploaded {BUCKET_PREFIX}{entry['slug']}.png")

    print("\nManifest shasums:")
    for entry in manifest:
        print(f"  {entry['sha256']}  {entry['slug']}.png")


if __name__ == "__main__":
    main()

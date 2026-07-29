// Canvas-baked paper grain (direction.md: ~55% zero-alpha coverage, 96px
// tile; dark rgb(38,51,58) at .06 for day/dusk, white at .05 for night).
// Patterns aren't runtime-tintable, hence the two bakes.

const SIZE = 96;

export function grainImage(rgb: [number, number, number], alphaMax: number): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(SIZE, SIZE);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = rgb[0];
    img.data[i + 1] = rgb[1];
    img.data[i + 2] = rgb[2];
    img.data[i + 3] = Math.random() < 0.55 ? 0 : Math.floor(Math.random() * alphaMax * 255);
  }
  return img;
}

export const GRAIN_BAKES = {
  "grain-dark": () => grainImage([38, 51, 58], 0.06),
  "grain-light": () => grainImage([255, 255, 255], 0.05),
} as const;

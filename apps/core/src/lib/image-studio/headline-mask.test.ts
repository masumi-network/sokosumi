import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  chooseHeadlineBand,
  HEADLINE_MASK_BAND_FRACTION,
  IDEOGRAM_MASK_EDIT,
  IDEOGRAM_MASK_KEEP,
  renderHeadlineMask,
} from "./headline-mask";

async function scene(options: {
  width?: number;
  height?: number;
  top: { r: number; g: number; b: number } | "busy";
  bottom: { r: number; g: number; b: number } | "busy";
}): Promise<Uint8Array> {
  const width = options.width ?? 64;
  const height = options.height ?? 64;
  const pixels = Buffer.alloc(width * height * 3);
  const mid = Math.floor(height / 2);
  for (let y = 0; y < height; y += 1) {
    const region = y < mid ? options.top : options.bottom;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      if (region === "busy") {
        const on = (x + y) % 3 === 0;
        pixels[i] = on ? 255 : 10;
        pixels[i + 1] = on ? 40 : 200;
        pixels[i + 2] = on ? 90 : 30;
      } else {
        pixels[i] = region.r;
        pixels[i + 1] = region.g;
        pixels[i + 2] = region.b;
      }
    }
  }
  return await sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

async function maskPixels(bytes: Uint8Array, width: number, height: number) {
  const { data } = await sharp(bytes)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(data.length).toBe(width * height);
  return data;
}

describe("chooseHeadlineBand", () => {
  it("picks the top when that band is the empty one", async () => {
    const bytes = await scene({
      top: { r: 245, g: 245, b: 245 },
      bottom: "busy",
    });
    expect(await chooseHeadlineBand(bytes)).toBe("top");
  });

  it("picks the bottom when that band is clearly emptier", async () => {
    const bytes = await scene({
      top: "busy",
      bottom: { r: 12, g: 12, b: 12 },
    });
    expect(await chooseHeadlineBand(bytes)).toBe("bottom");
  });

  it("prefers the top when both bands are similarly empty", async () => {
    const bytes = await scene({
      top: { r: 20, g: 20, b: 20 },
      bottom: { r: 18, g: 18, b: 18 },
    });
    expect(await chooseHeadlineBand(bytes)).toBe("top");
  });
});

describe("renderHeadlineMask", () => {
  it("emits a same-size PNG with a black edit band and white keep region", async () => {
    const width = 80;
    const height = 100;
    const source = await scene({
      width,
      height,
      top: { r: 250, g: 250, b: 250 },
      bottom: "busy",
    });
    const mask = await renderHeadlineMask(source);
    expect(mask.width).toBe(width);
    expect(mask.height).toBe(height);
    expect(mask.band).toBe("top");
    const bandRows = Math.round(height * HEADLINE_MASK_BAND_FRACTION);
    expect(mask.y0).toBe(0);
    expect(mask.y1).toBe(bandRows);
    const data = await maskPixels(mask.bytes, width, height);
    // A pixel inside the band is black (edit). A pixel well below it is white (keep).
    expect(data[0]).toBe(IDEOGRAM_MASK_EDIT);
    expect(data[(bandRows - 1) * width]).toBe(IDEOGRAM_MASK_EDIT);
    expect(data[bandRows * width]).toBe(IDEOGRAM_MASK_KEEP);
    expect(data[(height - 1) * width]).toBe(IDEOGRAM_MASK_KEEP);
  });

  it("can be forced to a bottom band of the same dimensions", async () => {
    const width = 40;
    const height = 50;
    const source = await scene({
      width,
      height,
      top: "busy",
      bottom: { r: 8, g: 8, b: 8 },
    });
    const mask = await renderHeadlineMask(source, "bottom");
    expect(mask.band).toBe("bottom");
    expect(mask.width).toBe(width);
    expect(mask.height).toBe(height);
    const bandRows = Math.round(height * HEADLINE_MASK_BAND_FRACTION);
    expect(mask.y0).toBe(height - bandRows);
    expect(mask.y1).toBe(height);
    const data = await maskPixels(mask.bytes, width, height);
    expect(data[0]).toBe(IDEOGRAM_MASK_KEEP);
    expect(data[mask.y0 * width]).toBe(IDEOGRAM_MASK_EDIT);
    expect(data[(height - 1) * width]).toBe(IDEOGRAM_MASK_EDIT);
  });
});

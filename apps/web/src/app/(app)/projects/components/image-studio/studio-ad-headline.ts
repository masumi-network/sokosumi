import type { StudioLogoPosition } from "@sokosumi/core-client";

export interface StudioHeadlineLook {
  colors?: string[];
  fonts?: string[];
  fontUrl?: string | null;
}

const FONT_TIMEOUT_MS = 5_000;
const fontLoads = new Map<string, Promise<string>>();
let fontId = 0;

function usesFontRange(headline: string, unicodeRange: string) {
  return unicodeRange.split(",").some((range) => {
    const match = range.trim().match(/^U\+([\da-f?]+)(?:-([\da-f]+))?$/i);
    if (!match) return true;
    const start = Number.parseInt(match[1].replaceAll("?", "0"), 16);
    const end = Number.parseInt(match[2] ?? match[1].replaceAll("?", "f"), 16);
    return Array.from(headline).some((character) => {
      const point = character.codePointAt(0) ?? 0;
      return point >= start && point <= end;
    });
  });
}

async function loadHeadlineFont(
  headline: string,
  fontUrl: string | undefined,
  name?: string,
) {
  const key = fontUrl ? `url:${fontUrl}` : JSON.stringify([name, headline]);
  const cached = fontLoads.get(key);
  if (cached) return cached;

  const family = `StudioHeadline${++fontId}`;
  async function loadFaces() {
    let faces: FontFace[];
    if (fontUrl) {
      faces = [
        new FontFace(family, `url(${JSON.stringify(fontUrl)})`, {
          weight: "700",
        }),
      ];
    } else {
      const url = new URL("https://fonts.googleapis.com/css2");
      url.searchParams.set("family", `${name}:wght@700`);
      const response = await fetch(url, {
        signal: AbortSignal.timeout(FONT_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error("Brand font stylesheet unavailable");
      const css = await response.text();
      faces = Array.from(css.matchAll(/@font-face\s*\{([^}]+)\}/g)).flatMap(
        ([, block]) => {
          const unicodeRange = block.match(/unicode-range:\s*([^;]+);/)?.[1];
          if (unicodeRange && !usesFontRange(headline, unicodeRange)) return [];
          const source = block.match(
            /url\((['"]?)(https:\/\/fonts\.gstatic\.com\/[^'"\s)]+)\1\)/,
          )?.[2];
          if (!source) throw new Error("Brand font source unavailable");
          return [
            new FontFace(family, `url(${JSON.stringify(source)})`, {
              weight: "700",
              ...(unicodeRange ? { unicodeRange } : {}),
            }),
          ];
        },
      );
      if (!faces.length) throw new Error("Brand font source unavailable");
    }
    return Promise.all(faces.map((face) => face.load()));
  }

  let timer: ReturnType<typeof setTimeout>;
  const loading = Promise.race([
    loadFaces(),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Brand font timed out")),
        FONT_TIMEOUT_MS,
      );
    }),
  ])
    .then((faces) => {
      for (const face of faces) document.fonts.add(face);
      return `"${family}", system-ui`;
    })
    .catch((error: unknown) => {
      fontLoads.delete(key);
      throw error;
    })
    .finally(() => clearTimeout(timer));
  fontLoads.set(key, loading);
  return loading;
}

async function headlineFont(headline: string, look?: StudioHeadlineLook) {
  const names = look?.fonts?.map((name) => name.trim()).filter(Boolean) ?? [];
  const sources = look?.fontUrl
    ? [{ url: look.fontUrl, name: undefined }]
    : names.map((name) => ({ url: undefined, name }));
  for (const source of sources) {
    try {
      return await loadHeadlineFont(headline, source.url, source.name);
    } catch {
      console.warn("Studio headline font unavailable; using a fallback.");
    }
  }
  return "system-ui";
}

function headlineColors(colors?: string[]) {
  const palette = (colors ?? []).flatMap((color) => {
    const hex = color.trim();
    if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(hex)) return [];
    const full =
      hex.length === 4
        ? hex
            .slice(1)
            .split("")
            .map((channel) => channel.repeat(2))
            .join("")
        : hex.slice(1);
    const channels = [0, 2, 4].map((index) =>
      Number.parseInt(full.slice(index, index + 2), 16),
    );
    const linear = channels.map((channel) => {
      const value = channel / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
    return [
      {
        hex,
        channels,
        luminance: linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722,
      },
    ];
  });
  if (!palette.length) {
    const theme = getComputedStyle(document.documentElement);
    return {
      text: theme.getPropertyValue("--on-media"),
      panel: theme.getPropertyValue("--media-ground"),
    };
  }
  const text = palette.find((color) => color.luminance < 0.8) ?? palette[0];
  function contrast(luminance: number) {
    return (
      (Math.max(text.luminance, luminance) + 0.05) /
      (Math.min(text.luminance, luminance) + 0.05)
    );
  }
  const panel = palette.reduce((best, color) =>
    contrast(color.luminance) > contrast(best.luminance) ? color : best,
  );
  // A single-color or low-contrast kit needs a contrasting shade of its brand color.
  const shade = text.channels.map((channel) =>
    Math.round(
      text.luminance > 0.179
        ? channel * 0.02
        : channel + (255 - channel) * 0.98,
    ),
  );
  return {
    text: text.hex,
    panel:
      contrast(panel.luminance) >= 4.5 ? panel.hex : `rgb(${shade.join(", ")})`,
  };
}

function wrapHeadline(
  context: CanvasRenderingContext2D,
  headline: string,
  width: number,
) {
  const graphemes = new Intl.Segmenter();
  const words = new Intl.Segmenter(undefined, { granularity: "word" });
  const lines: string[] = [];
  let line = "";
  for (const { segment } of words.segment(headline)) {
    if (context.measureText(line + segment).width <= width) {
      line += segment;
      continue;
    }
    if (line.trim()) lines.push(line.trimEnd());
    line = segment.trimStart();
    if (context.measureText(line).width <= width) continue;

    const longWord = line;
    line = "";
    for (const part of graphemes.segment(longWord)) {
      if (line && context.measureText(line + part.segment).width > width) {
        lines.push(line);
        line = "";
      }
      line += part.segment;
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}

export async function renderStudioHeadline(
  image: Blob,
  headline: string,
  logoPosition?: StudioLogoPosition,
  look?: StudioHeadlineLook,
): Promise<Blob> {
  const font = await headlineFont(headline, look);
  const colors = headlineColors(look?.colors);
  const bitmap = await createImageBitmap(image);
  try {
    const { width, height } = bitmap;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Studio headline canvas is unavailable");
    context.drawImage(bitmap, 0, 0);

    const shortEdge = Math.min(width, height);
    const inset = Math.max(1, Math.round(shortEdge * 0.04));
    const padding = Math.max(1, Math.round(shortEdge * 0.035));
    const panelWidth = Math.min(width - 2 * inset, Math.round(height * 1.25));
    const textWidth = panelWidth - 2 * padding;
    // Core places logos at a 4% inset and caps them at 15% of frame height.
    const top = logoPosition?.startsWith("top")
      ? Math.round(height * 0.15) + 2 * inset
      : inset;

    const minimumSize = Math.max(1, Math.round(shortEdge * 0.035));
    let size = Math.max(1, Math.round(shortEdge * 0.075));
    let lines: string[];
    let lineHeight: number;
    do {
      context.font = `700 ${size}px ${font}`;
      lines = wrapHeadline(context, headline, textWidth);
      lineHeight = Math.ceil(size * 1.25);
      if (
        lines.length * lineHeight + 2 * padding <= height * 0.4 &&
        lines.every((line) => context.measureText(line).width <= textWidth)
      ) {
        break;
      }
      size -= Math.max(1, Math.floor(size * 0.1));
    } while (size >= minimumSize);
    if (size < minimumSize || !lines.length)
      throw new Error("The Studio headline does not fit");

    context.fillStyle = colors.panel;
    context.fillRect(
      inset,
      top,
      panelWidth,
      lines.length * lineHeight + 2 * padding,
    );
    context.fillStyle = colors.text;
    context.textBaseline = "middle";
    for (const [index, line] of lines.entries()) {
      context.fillText(
        line,
        inset + padding,
        top + padding + (index + 0.5) * lineHeight,
      );
    }
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The Studio headline PNG could not be saved"));
      }, "image/png");
    });
  } finally {
    bitmap.close();
  }
}

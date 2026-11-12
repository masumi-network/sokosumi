import type { StudioLogoPosition } from "@sokosumi/core-client";

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
): Promise<Blob> {
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
      context.font = `700 ${size}px system-ui`;
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

    const theme = getComputedStyle(document.documentElement);
    context.fillStyle = theme.getPropertyValue("--media-ground");
    context.fillRect(
      inset,
      top,
      panelWidth,
      lines.length * lineHeight + 2 * padding,
    );
    context.fillStyle = theme.getPropertyValue("--on-media");
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

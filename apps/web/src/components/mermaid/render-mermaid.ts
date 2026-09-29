import DOMPurify from "dompurify";
import mermaid from "mermaid";

import {
  MAX_MERMAID_EDGES,
  MAX_MERMAID_LENGTH,
  mermaidSourceError,
} from "./mermaid-policy";

let queue = Promise.resolve();
let nextId = 0;
// Bounded, page-local results; never retain Blob URLs or failed renders.
const cache = new Map<string, string>();

/** SVG is untrusted even when produced by our pinned renderer. No active DOM. */
export function sanitizeMermaidSvg(svg: string): string {
  // DOMPurify does not sanitize CSS. Only local SVG marker references are allowed.
  const resources = svg.replace(/xmlns(?:[:\w-]*)="[^"]*"/g, "");
  if (
    /@import|@font-face|https?:|data:|javascript:|\/\/|\\/i.test(resources) ||
    [...resources.matchAll(/url\(([^)]*)\)/gi)].some(
      (match) => !/^#[\w-]+$/.test(match[1].trim().replace(/^["']|["']$/g, "")),
    )
  ) {
    throw new Error("Unsafe SVG resource");
  }
  const clean = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true },
    FORBID_TAGS: [
      "a",
      "image",
      "foreignObject",
      "use",
      "script",
      "animate",
      "animateMotion",
      "animateTransform",
      "set",
    ],
    FORBID_ATTR: ["href", "xlink:href", "src"],
  });
  if (!clean.includes("<svg")) throw new Error("Invalid SVG output");
  return clean;
}

export function renderMermaid(
  source: string,
  dark: boolean,
  signal: AbortSignal,
): Promise<string> {
  const render = queue.then(async () => {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (mermaidSourceError(source)) throw new Error("Unsupported flowchart");
    const tokens = getComputedStyle(document.documentElement);
    const cacheKey = JSON.stringify([
      source,
      dark,
      tokens.fontSize,
      ...["--card-background", "--muted", "--foreground"].map((token) =>
        tokens.getPropertyValue(token),
      ),
    ]);
    const cached = cache.get(cacheKey);
    if (cached) {
      cache.delete(cacheKey);
      cache.set(cacheKey, cached);
      return cached;
    }
    // Give input and paint a turn between diagrams. The active Mermaid layout
    // itself is synchronous and cannot be interrupted by AbortSignal.
    await new Promise<void>((resolve) => {
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(() => resolve(), { timeout: 100 });
      } else {
        setTimeout(resolve, 0);
      }
    });
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const canvas = document.createElement("canvas").getContext("2d");
    function color(token: string) {
      if (!canvas) throw new Error("Color conversion unavailable");
      canvas.fillStyle = tokens.getPropertyValue(token).trim();
      return canvas.fillStyle;
    }
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      maxTextSize: MAX_MERMAID_LENGTH,
      maxEdges: MAX_MERMAID_EDGES,
      theme: "base",
      look: "classic",
      themeVariables: {
        darkMode: dark,
        background: color("--card-background"),
        primaryColor: color("--muted"),
        primaryTextColor: color("--foreground"),
        primaryBorderColor: color("--foreground"),
        lineColor: color("--foreground"),
        secondaryColor: color("--muted"),
        tertiaryColor: color("--card-background"),
        edgeLabelBackground: color("--card-background"),
        fontSize: tokens.fontSize,
      },
      htmlLabels: false,
      flowchart: { useMaxWidth: false },
      fontFamily: "sans-serif",
      secure: [
        "securityLevel",
        "startOnLoad",
        "maxTextSize",
        "maxEdges",
        "suppressErrorRendering",
        "htmlLabels",
        "flowchart",
        "theme",
        "themeCSS",
        "themeVariables",
        "fontFamily",
        "dompurifyConfig",
        "secure",
      ],
    });
    const container = document.createElement("div");
    container.style.visibility = "hidden";
    container.style.position = "absolute";
    document.body.append(container);
    try {
      const { svg } = await mermaid.render(
        `sokosumi-mermaid-${++nextId}`,
        source,
        container,
      );
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const clean = sanitizeMermaidSvg(svg);
      // At most 16 results of at most 64K code units (roughly 2 MiB total).
      if (clean.length <= 65_536) {
        cache.set(cacheKey, clean);
        if (cache.size > 16) cache.delete(cache.keys().next().value!);
      }
      return clean;
    } finally {
      container.remove();
    }
  });
  // Keep Mermaid's global configuration and temporary DOM serialized, including failures.
  queue = render.then(
    () => {},
    () => {},
  );
  return render;
}

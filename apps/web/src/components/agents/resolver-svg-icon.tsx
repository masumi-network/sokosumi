import { useQuery } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import Image from "next/image";
import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

// Timeout for SVG fetch requests (5 seconds)
const SVG_FETCH_TIMEOUT_MS = 5000;

async function fetchSvgOrNull(
  url: string,
  signal: AbortSignal,
): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      mode: "cors",
      credentials: "omit",
      signal,
    });

    // Quick header-based detection
    const contentType = resp.headers.get("content-type")?.toLowerCase() ?? "";
    const text = await resp.text();
    const looksLikeSvg = /<svg[\s>]/i.test(text);

    if (contentType.includes("image/svg+xml") || looksLikeSvg) {
      return text;
    }
    return null;
  } catch {
    return null;
  }
}

function sanitizeAndColorize(svg: string): string {
  const sanitized = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true },
    KEEP_CONTENT: true,
    IN_PLACE: false,
  });

  let s = sanitized.replace(
    /\s(fill|stroke)=("|')([^"']*)\2/gi,
    (match: string, attr: string, quote: string, value: string): string => {
      if (value.trim().toLowerCase() !== "none") {
        return ` ${attr}="currentColor"`;
      }
      return match;
    },
  );

  s = s.replace(/<svg\b([^>]*)>/i, (match: string, attrs: string): string => {
    const cleaned = String(attrs).replace(
      /\s(width|height)=("|')[^"']*\2/gi,
      "",
    );
    return `<svg${cleaned} preserveAspectRatio="xMidYMid meet">`;
  });

  return s;
}

interface ResolverSVGIconProps {
  svgUrl: string | null;
  alt?: string;
  className?: string;
  size?: number;
  style?: CSSProperties;
}

export function ResolverSVGIcon({
  svgUrl,
  alt = "Icon",
  className,
  size = 24,
  style,
}: ResolverSVGIconProps) {
  const { data: svgMarkup } = useQuery({
    queryKey: ["resolver-svg-icon", svgUrl],
    enabled: Boolean(svgUrl),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }): Promise<string | null> => {
      if (!svgUrl) return null;

      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal.addEventListener("abort", onAbort, { once: true });
      const timeoutId = setTimeout(
        () => controller.abort(),
        SVG_FETCH_TIMEOUT_MS,
      );

      try {
        const svg = await fetchSvgOrNull(svgUrl, controller.signal);
        return svg ? sanitizeAndColorize(svg) : null;
      } finally {
        clearTimeout(timeoutId);
        signal.removeEventListener("abort", onAbort);
      }
    },
  });

  if (svgUrl) {
    // Inline SVG path
    if (svgMarkup) {
      return (
        <span
          className={cn("inline-block shrink-0", className)}
          role={alt ? "img" : undefined}
          aria-label={alt || undefined}
          aria-hidden={alt ? undefined : true}
          style={style}
          dangerouslySetInnerHTML={{ __html: svgMarkup }}
        />
      );
    }

    // Fallback to raster/external image
    return (
      <Image
        src={svgUrl}
        alt={alt}
        width={size}
        height={size}
        className={cn("shrink-0", className)}
        style={style}
        unoptimized
      />
    );
  }

  return undefined;
}

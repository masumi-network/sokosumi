import DOMPurify from "dompurify";
import Image from "next/image";
import { CSSProperties, useEffect, useState } from "react";

import { cn } from "@/lib/utils";

// Timeout for SVG fetch requests (5 seconds)
const SVG_FETCH_TIMEOUT_MS = 5000;

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
  const [svgState, setSvgState] = useState<{
    url: string;
    markup: string;
  } | null>(null);

  useEffect(() => {
    if (!svgUrl) return;

    let isMounted = true;
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      SVG_FETCH_TIMEOUT_MS,
    );

    async function fetchSvgOrNull(url: string): Promise<string | null> {
      try {
        const resp = await fetch(url, {
          mode: "cors",
          credentials: "omit",
          signal: controller.signal,
        });

        // Quick header-based detection
        const contentType =
          resp.headers.get("content-type")?.toLowerCase() ?? "";
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

      s = s.replace(
        /<svg\b([^>]*)>/i,
        (match: string, attrs: string): string => {
          const cleaned = String(attrs).replace(
            /\s(width|height)=("|')[^"']*\2/gi,
            "",
          );
          return `<svg${cleaned} preserveAspectRatio="xMidYMid meet">`;
        },
      );

      return s;
    }

    fetchSvgOrNull(svgUrl)
      .then((svg) => {
        if (!isMounted) return;
        if (svgUrl && svg) {
          setSvgState({ url: svgUrl, markup: sanitizeAndColorize(svg) });
        } else {
          setSvgState(null);
        }
      })
      .catch((error) => {
        // Silently fail for aborted requests, log others
        if (!isMounted) return;
        if (error.name !== "AbortError") {
          console.warn("Failed to load SVG icon:", error);
        }
        setSvgState(null);
      });

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [svgUrl]);

  if (svgUrl) {
    // Inline SVG path
    const shouldRenderInline = svgState && svgState.url === svgUrl;
    if (shouldRenderInline) {
      return (
        <span
          className={cn("inline-block shrink-0", className)}
          role={alt ? "img" : undefined}
          aria-label={alt || undefined}
          aria-hidden={alt ? undefined : true}
          style={style}
          dangerouslySetInnerHTML={{ __html: svgState.markup }}
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

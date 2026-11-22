"use client";

import DOMPurify from "dompurify";
import { useEffect, useState } from "react";

// Timeout for SVG fetch requests (5 seconds)
const SVG_FETCH_TIMEOUT_MS = 5000;

export interface ResolvedSvgMarkup {
  url: string;
  markup: string;
}

/**
 * Fetches, sanitizes, and colorizes an SVG URL for `ResolverSVGIcon` with a
 * 5-second abort timeout. Markup is keyed by URL; the caller ignores markup
 * for a different URL.
 */
export function useResolverSvgMarkup(
  svgUrl: string | null,
): ResolvedSvgMarkup | null {
  const [svgState, setSvgState] = useState<ResolvedSvgMarkup | null>(null);

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

  return svgState;
}

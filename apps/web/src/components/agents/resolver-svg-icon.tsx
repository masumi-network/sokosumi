import Image from "next/image";
import { CSSProperties, useEffect, useMemo, useState } from "react";

import { ipfsUrlResolver } from "@/lib/ipfs";
import { cn } from "@/lib/utils";

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
  const resolvedUrl = useMemo(
    () => (svgUrl ? ipfsUrlResolver(svgUrl) : null),
    [svgUrl],
  );

  const [svgState, setSvgState] = useState<{
    url: string;
    markup: string;
  } | null>(null);

  useEffect(() => {
    if (!resolvedUrl) return;

    let isMounted = true;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

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
      let s = svg
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/\son\w+=(?:"[^"]*"|'[^']*')/gi, "");

      // Replace all fill and stroke attributes throughout the SVG with currentColor
      s = s.replace(
        /\s(fill|stroke)=("|')([^"']*)\2/gi,
        (match, attr, quote, value) => {
          // Only replace if the color is not "none"
          if (value.trim().toLowerCase() !== "none") {
            return ` ${attr}="currentColor"`;
          }
          return match; // leave as is if "none"
        },
      );

      // Clean SVG tag: remove width/height, but don't add fill/stroke
      s = s.replace(/<svg\b([^>]*)>/i, (match, attrs) => {
        const cleaned = String(attrs).replace(
          /\s(width|height)=("|')[^"']*\2/gi,
          "",
        );
        return `<svg${cleaned} preserveAspectRatio="xMidYMid meet">`;
      });

      return s;
    }

    fetchSvgOrNull(resolvedUrl).then((svg) => {
      if (!isMounted) return;
      if (svg) {
        setSvgState({ url: resolvedUrl, markup: sanitizeAndColorize(svg) });
      } else {
        setSvgState(null);
      }
    });

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [resolvedUrl]);

  // Inline SVG path
  const shouldRenderInline = svgState && svgState.url === resolvedUrl;
  if (shouldRenderInline) {
    return (
      <span
        className={cn("inline-block shrink-0", className)}
        role={alt ? "img" : undefined}
        aria-label={alt || undefined}
        aria-hidden={alt ? undefined : true}
        dangerouslySetInnerHTML={{ __html: svgState.markup }}
      />
    );
  }

  // Fallback to raster/external image
  if (resolvedUrl) {
    return (
      <Image
        src={resolvedUrl}
        alt={alt}
        width={size}
        height={size}
        className={cn("shrink-0", className)}
        style={style}
        unoptimized
      />
    );
  } else {
    return null;
  }
}

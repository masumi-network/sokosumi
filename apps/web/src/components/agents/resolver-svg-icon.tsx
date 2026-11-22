import Image from "next/image";
import type { CSSProperties } from "react";

import { useResolverSvgMarkup } from "@/hooks/effects/use-resolver-svg-markup";
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
  const svgState = useResolverSvgMarkup(svgUrl);

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

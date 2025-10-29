"use client";

import { cn } from "@/lib/utils";

export interface FaviconProps
  extends React.ImgHTMLAttributes<HTMLImageElement> {
  sources: string[];
  alt: string;
  /** Pixel size for width/height. Defaults to 32. */
  size?: number;
}

export function Favicon(props: FaviconProps) {
  const { sources, alt, size = 32, className, ...imgProps } = props;
  if (!sources?.length) return null;

  return (
    <img
      src={sources[0]}
      alt={alt}
      width={size}
      height={size}
      className={cn("object-contain", className)}
      onError={(e) => {
        const el = e.currentTarget as HTMLImageElement & { _i?: number };
        const next = ((el._i ?? 0) + 1) as number;
        el._i = next;
        if (next < sources.length) el.src = sources[next];
      }}
      {...imgProps}
    />
  );
}



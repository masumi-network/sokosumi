"use client";

import Image from "next/image";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { LOGO_SIZE, type LogoSize, logoHeight } from "./agent-vendor-size";

// brightness(0) then invert(n) paints every pixel the muted text grey:
// #525252 in light, #a3a3a3 in dark.
const LOGO_CLASS =
  "w-auto object-contain object-left brightness-0 invert-[0.32] dark:invert-[0.64] transition-opacity duration-150";

/**
 * Who makes a marketplace agent. The author logo comes first, as the old
 * gallery showed it: an admin override usually sets only the logo, and the
 * registry's author name under it is often a placeholder.
 */
export function AgentVendor({
  logo,
  label,
  alt,
  size = "md",
}: {
  logo: string | null;
  label: string;
  alt: string;
  size?: LogoSize;
}) {
  const [ratio, setRatio] = useState<number | null>(null);
  if (!logo) return <span className="min-w-0 truncate">{label}</span>;
  const height = ratio ? logoHeight(ratio, size) : LOGO_SIZE[size].min;
  return (
    <Image
      src={logo}
      alt={alt}
      width={LOGO_SIZE[size].maxWidth}
      height={LOGO_SIZE[size].max}
      unoptimized
      onLoad={(event) => {
        const image = event.currentTarget;
        if (image.naturalHeight > 0) {
          setRatio(image.naturalWidth / image.naturalHeight);
        }
      }}
      style={{ height, maxWidth: LOGO_SIZE[size].maxWidth }}
      className={cn(LOGO_CLASS, !ratio && "opacity-0")}
    />
  );
}

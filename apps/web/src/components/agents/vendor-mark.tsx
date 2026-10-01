"use client";

import type { Vendor } from "@sokosumi/core-client";
import { useState } from "react";

import { cn } from "@/lib/utils";

const VENDOR_LOGOS: Record<string, { light: string; dark: string }> = {
  sokosumi: {
    light: "/images/logos/sokosumi-logo-black.svg",
    dark: "/images/logos/sokosumi-logo-white.svg",
  },
};

interface VendorMarkProps {
  vendor: Pick<Vendor, "name" | "slug" | "logos">;
  className?: string;
  textClassName?: string;
}

function VendorLogoImages({
  lightSrc,
  darkSrc,
  alt,
  className,
  onError,
}: {
  lightSrc: string;
  darkSrc: string;
  alt: string;
  className?: string;
  onError: () => void;
}) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={lightSrc}
        alt={alt}
        onError={onError}
        className={cn("w-auto object-contain dark:hidden", className)}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={darkSrc}
        alt={alt}
        onError={onError}
        className={cn("hidden w-auto object-contain dark:block", className)}
      />
    </>
  );
}

/**
 * Renders vendor logos when available, otherwise — or when a logo fails to
 * load — the vendor name, so a broken image never shows its alt text.
 */
export function VendorMark({
  vendor,
  className = "h-5",
  textClassName,
}: VendorMarkProps) {
  const [logoFailed, setLogoFailed] = useState(false);
  const { light, dark } = vendor.logos;
  const asset = VENDOR_LOGOS[vendor.slug];
  const lightSrc = light ?? dark ?? asset?.light;
  const darkSrc = dark ?? light ?? asset?.dark;

  if (lightSrc && darkSrc && !logoFailed) {
    return (
      <VendorLogoImages
        lightSrc={lightSrc}
        darkSrc={darkSrc}
        alt={vendor.name}
        className={className}
        onError={() => setLogoFailed(true)}
      />
    );
  }

  return (
    <span className={textClassName ?? "text-foreground text-sm font-semibold"}>
      {vendor.name}
    </span>
  );
}

import type { Vendor } from "@/lib/clients/generated/core";
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
}: {
  lightSrc: string;
  darkSrc: string;
  alt: string;
  className?: string;
}) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={lightSrc}
        alt={alt}
        className={cn("w-auto object-contain dark:hidden", className)}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={darkSrc}
        alt={alt}
        className={cn("hidden w-auto object-contain dark:block", className)}
      />
    </>
  );
}

/**
 * Renders vendor logos when available, otherwise falls back to the vendor name.
 */
export function VendorMark({
  vendor,
  className = "h-5",
  textClassName,
}: VendorMarkProps) {
  const { light, dark } = vendor.logos;

  if (light || dark) {
    return (
      <VendorLogoImages
        lightSrc={light ?? dark ?? ""}
        darkSrc={dark ?? light ?? ""}
        alt={vendor.name}
        className={className}
      />
    );
  }

  const asset = VENDOR_LOGOS[vendor.slug];
  if (asset) {
    return (
      <VendorLogoImages
        lightSrc={asset.light}
        darkSrc={asset.dark}
        alt={vendor.name}
        className={className}
      />
    );
  }

  return (
    <span className={textClassName ?? "text-foreground text-sm font-semibold"}>
      {vendor.name}
    </span>
  );
}

/** @deprecated Use VendorMark with a vendor object. */
export function CompanyMark({
  company,
  className,
  textClassName,
}: {
  company: string;
  className?: string;
  textClassName?: string;
}) {
  return (
    <VendorMark
      vendor={{
        name: company,
        slug: company.trim().toLowerCase(),
        logos: { light: null, dark: null },
      }}
      className={className}
      textClassName={textClassName}
    />
  );
}

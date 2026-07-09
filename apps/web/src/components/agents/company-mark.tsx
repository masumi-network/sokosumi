import type { Vendor } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

const VENDOR_LOGOS: Record<string, { light: string; dark: string }> = {
  "service-plan": {
    light: "/images/logos/serviceplan-logo.png",
    dark: "/images/logos/serviceplan-logo-white.png",
  },
  sokosumi: {
    light: "/images/logos/sokosumi-logo-black.svg",
    dark: "/images/logos/sokosumi-logo-white.svg",
  },
};

interface VendorMarkProps {
  vendor: Pick<Vendor, "name" | "slug" | "logo">;
  className?: string;
  textClassName?: string;
}

/**
 * Renders a vendor logo when available, otherwise falls back to the vendor name.
 */
export function VendorMark({
  vendor,
  className = "h-5",
  textClassName,
}: VendorMarkProps) {
  if (vendor.logo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={vendor.logo}
        alt={vendor.name}
        className={cn("w-auto object-contain", className)}
      />
    );
  }

  const asset = VENDOR_LOGOS[vendor.slug];
  if (asset) {
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.light}
          alt={vendor.name}
          className={cn("w-auto object-contain dark:hidden", className)}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.dark}
          alt={vendor.name}
          className={cn("hidden w-auto object-contain dark:block", className)}
        />
      </>
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
      vendor={{ name: company, slug: company.trim().toLowerCase(), logo: null }}
      className={className}
      textClassName={textClassName}
    />
  );
}

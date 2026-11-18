import type { VendorMembership } from "@sokosumi/core-client";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { getVendorLogoUrls } from "./vendor-logo-urls";

interface DeveloperVendorsListProps {
  adminVendors: VendorMembership[];
}

// Wordmarks are wide: fit the whole logo inside the circle on the row's own
// surface, so neither the fallback letter nor a crop shows through.
function VendorAvatar({
  src,
  name,
  theme,
  className,
}: {
  src: string | undefined;
  name: string;
  theme: "light" | "dark";
  className: string;
}) {
  return (
    <Avatar
      data-testid={`vendor-logo-${theme}`}
      className={cn("size-10 shrink-0", className)}
    >
      <AvatarImage
        src={src}
        alt={name}
        className="bg-muted object-contain p-1"
      />
      <AvatarFallback className="bg-primary text-primary-foreground text-sm">
        {name.charAt(0).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

export async function DeveloperVendorsList({
  adminVendors,
}: DeveloperVendorsListProps) {
  const t = await getTranslations("App.Developer.Vendors");

  if (adminVendors.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("List.empty")}</p>;
  }

  return (
    <ul className="divide-border divide-y rounded-lg border">
      {adminVendors.map((vendor) => {
        const logos = getVendorLogoUrls(vendor);

        return (
          <li
            key={vendor.id}
            className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 items-start gap-3">
              {/* One avatar per theme, so a logo that fails in one theme
                  falls back to the initial without the other theme's image
                  hiding that fallback. */}
              <VendorAvatar
                src={logos.light}
                name={vendor.name}
                theme="light"
                className="dark:hidden"
              />
              <VendorAvatar
                src={logos.dark}
                name={vendor.name}
                theme="dark"
                className="hidden dark:flex"
              />
              <div className="min-w-0 space-y-1">
                <p className="truncate font-medium">{vendor.name}</p>
                <p className="text-muted-foreground font-mono text-xs">
                  {vendor.slug}
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" asChild className="shrink-0">
              <Link href={`/developer/vendors/${vendor.id}`}>
                {t("List.manage")}
              </Link>
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

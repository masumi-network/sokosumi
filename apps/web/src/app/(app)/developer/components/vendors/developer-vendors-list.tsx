import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { VendorMembership } from "@/lib/clients/generated/core";

interface DeveloperVendorsListProps {
  adminVendors: VendorMembership[];
}

function getVendorLogoUrl(vendor: VendorMembership): string | undefined {
  return vendor.logos.light ?? vendor.logos.dark ?? undefined;
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
        const logoUrl = getVendorLogoUrl(vendor);

        return (
          <li
            key={vendor.id}
            className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 items-start gap-3">
              <Avatar className="size-10 shrink-0">
                {logoUrl ? (
                  <AvatarImage src={logoUrl} alt={vendor.name} />
                ) : null}
                <AvatarFallback className="bg-primary text-primary-foreground text-sm">
                  {vendor.name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
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

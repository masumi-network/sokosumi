import { getTranslations } from "next-intl/server";

import type { VendorMembership } from "@/lib/clients/generated/core";

import { VendorAdminPanel } from "./vendor-admin-panel";

interface DeveloperVendorsSectionProps {
  adminVendors: VendorMembership[];
}

export async function DeveloperVendorsSection({
  adminVendors,
}: DeveloperVendorsSectionProps) {
  const t = await getTranslations("App.Developer.Vendors");

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </div>
      <VendorAdminPanel adminVendors={adminVendors} />
    </div>
  );
}

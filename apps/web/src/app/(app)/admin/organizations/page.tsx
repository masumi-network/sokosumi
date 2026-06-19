import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { OrganizationList } from "@/components/admin/organizations/organization-list";
import { adminOrganizationService } from "@/lib/services/admin-organization.service";

export const metadata: Metadata = {
  title: "Organizations",
  description: "Searchable overview of all organizations",
};

export default async function AdminOrganizationsPage() {
  const t = await getTranslations("App.Admin.Organizations");
  const initialPage = await adminOrganizationService.listOrganizations();

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>

        <OrganizationList initialPage={initialPage} />
      </div>
    </div>
  );
}

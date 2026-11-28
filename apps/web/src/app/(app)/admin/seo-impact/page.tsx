import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { SeoImpactTable } from "@/components/admin/seo-impact-table";
import {
  ADMIN_SEO_IMPACT_PERIODS,
  ADMIN_SEO_IMPACT_SOURCES,
  adminSeoImpactFilters,
  readAdminSeoImpact,
} from "@/lib/services/admin-seo-impact.service";

export const instant = false;

export const metadata: Metadata = {
  title: "SEO impact",
  description: "Page changes tracked for an SEO impact verdict",
};

export default async function AdminSeoImpactPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; state?: string; source?: string }>;
}) {
  const filters = adminSeoImpactFilters(await searchParams);
  const [t, verdicts] = await Promise.all([
    getTranslations("App.Admin.SeoImpact"),
    readAdminSeoImpact(filters),
  ]);
  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>
        <SeoImpactTable
          verdicts={verdicts}
          filters={filters}
          periods={ADMIN_SEO_IMPACT_PERIODS}
          sources={ADMIN_SEO_IMPACT_SOURCES}
        />
      </div>
    </div>
  );
}

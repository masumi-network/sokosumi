import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { SeoImpactTable } from "@/components/admin/seo-impact-table";
import {
  ADMIN_SEO_IMPACT_PERIODS,
  adminSeoImpactPeriod,
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
  searchParams: Promise<{ period?: string }>;
}) {
  const period = adminSeoImpactPeriod((await searchParams).period);
  const [t, verdicts] = await Promise.all([
    getTranslations("App.Admin.SeoImpact"),
    readAdminSeoImpact(period),
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
          period={period}
          periods={ADMIN_SEO_IMPACT_PERIODS}
        />
      </div>
    </div>
  );
}

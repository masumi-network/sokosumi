import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { CmoSpendTable } from "@/components/admin/cmo-spend-table";
import { adminSokoBotService } from "@/lib/services/admin-soko-bot.service";

export const instant = false;

export const metadata: Metadata = {
  title: "CMO spend",
  description: "What each CMO bot spent, and on what",
};

const PERIODS = [7, 30, 90] as const;

export default async function AdminCmoSpendPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const requested = Number((await searchParams).days);
  const days = PERIODS.find((period) => period === requested) ?? 30;
  const [t, spend] = await Promise.all([
    getTranslations("App.Admin.CmoSpend"),
    adminSokoBotService.cmoSpend(days),
  ]);
  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>
        <CmoSpendTable spend={spend} days={days} periods={[...PERIODS]} />
      </div>
    </div>
  );
}

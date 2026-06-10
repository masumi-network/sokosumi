import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { CreditGrantForm } from "@/components/admin/credit-grants/credit-grant-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { creditGrantAdminService } from "@/lib/services/credit-grant-admin.service";

export const metadata: Metadata = {
  title: "New credit grant",
  description: "Grant one-time credits to a user or organization",
};

export default async function NewCreditGrantPage() {
  const t = await getTranslations("App.Admin.CreditGrants");
  const prices = await creditGrantAdminService.listPrices();

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("cardTitle")}
            </h1>
            <p className="text-muted-foreground text-sm">{t("description")}</p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/admin/credit-grants">{t("backToList")}</Link>
          </Button>
        </div>

        <Card>
          <CardContent>
            <CreditGrantForm prices={prices} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

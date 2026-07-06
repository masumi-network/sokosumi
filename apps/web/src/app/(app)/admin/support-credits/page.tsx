import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { SupportCreditForm } from "@/components/admin/support-credits/support-credit-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Support credits",
  description: "Grant support credits to a user or organization",
};

export default async function SupportCreditsPage() {
  const t = await getTranslations("App.Admin.SupportCredits");

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("title")}
            </h1>
            <p className="text-muted-foreground text-sm">{t("description")}</p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/admin">{t("backToAdmin")}</Link>
          </Button>
        </div>

        <Card>
          <CardContent>
            <SupportCreditForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

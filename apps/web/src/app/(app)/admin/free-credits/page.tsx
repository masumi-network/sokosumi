import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { FreeCreditForm } from "@/components/admin/free-credits/free-credit-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Free credits",
  description: "Grant free credits to a user or organization",
};

export default async function FreeCreditsPage() {
  const t = await getTranslations("App.Admin.FreeCredits");

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
            <FreeCreditForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

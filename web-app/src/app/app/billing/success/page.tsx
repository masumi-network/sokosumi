import { CheckCircle } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function BillingSuccessPage() {
  const t = await getTranslations("App.Billing.Success");

  return (
    <div className="mx-auto max-w-xl p-6">
      <Card className="text-center">
        <CardHeader>
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
            <CheckCircle className="size-6 text-green-600 dark:text-green-400" />
          </div>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">
            {t("fulfillmentNote")}
          </p>
          <Button asChild>
            <Link href="/app">{t("backToDashboard")}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

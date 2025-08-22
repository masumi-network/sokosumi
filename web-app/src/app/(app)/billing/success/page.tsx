import { CheckCircle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CheckoutSessionData, stripeClient } from "@/lib/clients";

import PurchaseTracker from "./components/purchase-tracker";

interface BillingSuccessPageProps {
  searchParams: Promise<{
    session_id?: string;
  }>;
}

export default async function BillingSuccessPage({
  searchParams,
}: BillingSuccessPageProps) {
  const t = await getTranslations("App.Billing.Success");

  const { session_id } = await searchParams;
  let checkoutSession: CheckoutSessionData | null = null;

  try {
    if (session_id) {
      checkoutSession = await stripeClient.getCheckoutSessionData(session_id);
    }
  } catch (error) {
    console.error(error);
  }

  if (!checkoutSession) {
    return notFound();
  }
  console.log(checkoutSession);

  return (
    <div className="mx-auto max-w-xl p-6">
      <PurchaseTracker checkoutSession={checkoutSession} />
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
            <Link href="/">{t("backToDashboard")}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

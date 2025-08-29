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
import { CheckoutSessionData } from "@/lib/clients";
import { AgentWithCreditsPrice } from "@/lib/db";
import { agentService } from "@/lib/services";

import PurchaseTracker from "./purchase-tracker";

interface SuccessCardProps {
  checkoutSession: CheckoutSessionData;
}

export default async function SuccessCard({
  checkoutSession,
}: SuccessCardProps) {
  const t = await getTranslations("App.Billing.Success");

  let _agent: AgentWithCreditsPrice | null = null;
  try {
    _agent = await agentService.getRandomAvailableAgentWithCreditsPrice();
  } catch (error) {
    console.error("Failed to get random available agent", error);
  }

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

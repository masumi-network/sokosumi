"use client";

import { AlertCircle, CheckCircle } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckoutSessionData } from "@/lib/clients";

import PurchaseTracker from "./purchase-tracker";

interface SuccessCardProps {
  checkoutSession: CheckoutSessionData;
  children: React.ReactNode;
}

export default function SuccessCard({
  checkoutSession,
  children,
}: SuccessCardProps) {
  const t = useTranslations("App.Billing.Success");

  return (
    <div className="mx-auto max-w-xl p-2">
      <PurchaseTracker checkoutSession={checkoutSession} />
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
            <CheckCircle className="size-6 text-green-600 dark:text-green-400" />
          </div>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">{children}</CardContent>
      </Card>
    </div>
  );
}

export function SuccessCardLoading() {
  return (
    <div className="mx-auto max-w-xl p-2">
      <Card className="text-center">
        <CardHeader>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-6 w-full" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-8 w-16" />
        </CardContent>
      </Card>
    </div>
  );
}

export function SuccessCardError() {
  const t = useTranslations("App.Billing.Success.Error");

  return (
    <div className="mx-auto max-w-xl p-2">
      <Card className="text-center">
        <CardHeader>
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900">
            <AlertCircle className="size-6 text-red-600 dark:text-red-400" />
          </div>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

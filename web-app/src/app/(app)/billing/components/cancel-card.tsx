"use client";

import { XCircle } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function CancelCard() {
  const t = useTranslations("App.Billing.Cancel");

  return (
    <Card className="text-center">
      <CardHeader>
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900">
          <XCircle className="size-6 text-red-600 dark:text-red-400" />
        </div>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link href="/billing">{t("backToBilling")}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

"use client"; // Error components must be Client Components

import { useTranslations } from "next-intl"; // Import useTranslations
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function BillingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("App.Billing.Error"); // Initialize translations hook

  useEffect(() => {
    // Log the error to an error reporting service or console
    console.error("Billing Page Error:", error);
  }, [error]);

  return (
    <div className="flex h-full items-center justify-center p-6">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">{t("message")}</p>
          <Button
            onClick={
              // Attempt to recover by trying to re-render the segment
              () => reset()
            }
          >
            {t("retryButton")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

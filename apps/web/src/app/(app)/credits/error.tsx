"use client"; // Error components must be Client Components

import { useTranslations } from "next-intl"; // Import useTranslations

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useUnAuthenticatedErrorHandler } from "@/hooks/use-unauthenticated-error-handler";

export default function CreditsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("App.Credits.Error"); // Initialize translations hook
  const { renderIfAuthenticated } = useUnAuthenticatedErrorHandler(error);

  return renderIfAuthenticated(
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-4xl px-4 py-6">
        <div className="flex items-center justify-center">
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
      </div>
    </div>,
  );
}

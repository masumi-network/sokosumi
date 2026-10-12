"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  reportRouteError,
  shouldReportRouteError,
} from "@/lib/sentry/report-route-error";

interface ErrorStateProps {
  error: Error & { digest?: string };
  title: string;
  description: string;
  onRetry: () => void;
  secondaryHref?: string;
  secondaryLabel?: string;
}

export function ErrorState({
  error,
  title,
  description,
  onRetry,
  secondaryHref,
  secondaryLabel,
}: ErrorStateProps) {
  const t = useTranslations("App.Error");
  const notified = shouldReportRouteError(error);

  useEffect(() => {
    reportRouteError(error);
  }, [error]);

  return (
    <div
      className="flex min-h-[80dvh] w-full items-center justify-center px-4"
      data-testid="route-error-state"
    >
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-muted-foreground">{description}</p>
          {notified ? (
            <p className="text-muted-foreground text-sm">{t("notified")}</p>
          ) : null}
          {error.digest ? (
            <p className="text-muted-foreground text-xs select-all">
              {t("errorId", { errorId: error.digest })}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <Button className="w-full" onClick={onRetry} variant="primary">
            {t("tryAgain")}
          </Button>
          {secondaryHref && secondaryLabel ? (
            <Button asChild className="w-full" variant="secondary">
              <Link href={secondaryHref}>{secondaryLabel}</Link>
            </Button>
          ) : null}
        </CardFooter>
      </Card>
    </div>
  );
}

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
import { useErrorCardCopy } from "@/hooks/use-error-card-copy";
import { useUnAuthenticatedErrorHandler } from "@/hooks/use-unauthenticated-error-handler";

/**
 * `(flows)` had no boundary, so anything a flow page threw reached
 * `global-error.tsx`, the bare unstyled "Application error" screen. `/setup`
 * handles its own Core outage, but `/join` and `/accept-invitation` still
 * throw for every other failure.
 *
 * A real logout still has to reach /signin, so this carries the same
 * `useUnAuthenticatedErrorHandler` the `(app)` boundary does: a server action
 * that throws `UnAuthenticatedError` redirects instead of showing a card the
 * user cannot act on. Only a Core outage stops at the card.
 *
 * Reuses the `App.Error` strings rather than adding a fourth copy of the same
 * four keys.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("App.Error");
  const copy = useErrorCardCopy(error);
  const { renderIfAuthenticated } = useUnAuthenticatedErrorHandler(error);

  useEffect(() => {
    console.error(error);
  }, [error]);

  return renderIfAuthenticated(
    <div className="container mx-auto flex min-h-[80vh] items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{copy.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">{copy.description}</p>
          {error.digest && (
            <p className="text-muted-foreground text-xs">
              {t("errorId", { errorId: error.digest })}
            </p>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <Button onClick={reset} variant="primary" className="w-full">
            {t("tryAgain")}
          </Button>
          <Button asChild variant="secondary" className="w-full">
            <Link href="/">{t("goApp")}</Link>
          </Button>
        </CardFooter>
      </Card>
    </div>,
  );
}

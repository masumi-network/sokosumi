"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { UnAuthorizedError } from "@/lib/auth/errors";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("App.Error");
  const router = useRouter();

  useEffect(() => {
    // Redirect to login if the error is UnAuthorizedError
    if (error instanceof UnAuthorizedError) {
      router.push("/login");
      return;
    }
  }, [error, router]);

  // Don't render the error UI if it's an UnAuthorizedError since we're redirecting
  if (error instanceof UnAuthorizedError) {
    return null;
  }

  return (
    <div className="container mx-auto flex min-h-[80vh] items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">{t("description")}</p>
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
            <Link href="/app">{t("goApp")}</Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

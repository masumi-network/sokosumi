"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Shown when the app shell could not read the session because Core was
 * unreachable. The shell gates run inside `(app)/layout.tsx`, and Next does
 * not route a layout's own error to that segment's `error.tsx` — it goes to
 * `global-error`, which is the bare "Application error" page. Rendering this
 * instead keeps a Core stall inside the themed app UI, and keeps it apart
 * from a real logout, which still redirects to /signin.
 */
export function CoreUnavailableNotice() {
  const t = useTranslations("App.Error");

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-4xl items-center justify-center px-4 py-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("unavailableTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{t("unavailableDescription")}</p>
        </CardContent>
        <CardFooter>
          <Button
            className="w-full"
            onClick={() => {
              window.location.reload();
            }}
            variant="primary"
          >
            {t("tryAgain")}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

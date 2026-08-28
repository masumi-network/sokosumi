"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export default function CalendarError({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  const t = useTranslations("App.Calendar");

  return (
    <div className="flex min-h-80 flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-semibold">{t("error.title")}</h1>
      <p className="text-muted-foreground text-sm">{t("error.description")}</p>
      <Button onClick={reset}>{t("error.retry")}</Button>
    </div>
  );
}

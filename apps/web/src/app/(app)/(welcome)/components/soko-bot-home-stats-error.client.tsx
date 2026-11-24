"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";

import { LoadErrorState } from "@/components/common/load-error-state";

/**
 * The day's numbers could not load. The rest of Home stays, so only their
 * section says so, and retrying asks the server for Home again.
 */
export function SokoBotHomeStatsError() {
  const t = useTranslations("App.Chat.Landing.stats");
  const router = useRouter();
  const [retrying, startTransition] = useTransition();

  return (
    <LoadErrorState
      className="mx-3 mb-2"
      description={t("loadError.help")}
      retrying={retrying}
      retryLabel={t("loadError.retry")}
      title={t("loadError.title")}
      variant="banner"
      onRetry={() => startTransition(() => router.refresh())}
    />
  );
}

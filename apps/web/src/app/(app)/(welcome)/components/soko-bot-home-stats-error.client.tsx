"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";

import { LoadErrorState } from "@/components/common/load-error-state";
import { refreshPage } from "@/lib/actions/refresh-page-action";

/**
 * The day's numbers could not load. The rest of Home stays, so only their
 * section says so, and retrying renders Home again on the server.
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
      onRetry={() =>
        // The action renders Home again and keeps the pages prefetched for
        // the next click; without a session it declines, and a plain
        // refresh sends the reader to sign in.
        startTransition(async () => {
          const refreshed = await refreshPage().catch(() => false);
          if (!refreshed) router.refresh();
        })
      }
    />
  );
}

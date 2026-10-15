"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";

import type { AdsLoadError } from "./ads-load-error";

interface AdsErrorStateProps {
  kind: AdsLoadError;
  /** What could not be loaded, named by the caller: "Failed to load ads". */
  failedTitle: string;
  /** What is not set up: "Market data isn't available yet". */
  unavailableTitle: string;
}

/**
 * A section's own error, so the rest of the page stays usable. Not set up has
 * nothing to retry; a failure can be tried again.
 */
export function AdsErrorState({
  kind,
  failedTitle,
  unavailableTitle,
}: AdsErrorStateProps) {
  const t = useTranslations("App.Ads.loadError");
  const router = useRouter();

  if (kind === "unavailable") {
    return (
      <EmptyState
        description={t("unavailableDescription")}
        title={unavailableTitle}
      />
    );
  }

  return (
    <EmptyState
      action={
        <Button type="button" onClick={() => router.refresh()}>
          {t("retry")}
        </Button>
      }
      description={t("failedDescription")}
      title={failedTitle}
    />
  );
}

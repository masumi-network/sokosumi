"use client";

import type { ProjectAdProvider } from "@sokosumi/core-client";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";

import { AdsErrorState } from "./ads-error-state";
import type { AdsLoadError } from "./ads-load-error";

export type CampaignsLoadError = "not_active" | AdsLoadError;

interface AdsCampaignsErrorProps {
  kind: CampaignsLoadError;
  projectId: string;
  provider: ProjectAdProvider;
}

/** The Campaigns tab's own error, so the rest of the page stays usable. */
export function AdsCampaignsError({
  kind,
  projectId,
  provider,
}: AdsCampaignsErrorProps) {
  const t = useTranslations("App.Ads.campaigns.errors");
  const tProvider = useTranslations("App.Ads.accounts.providers");

  if (kind === "not_active") {
    const params = new URLSearchParams({ projectId, tab: "accounts" });
    return (
      <EmptyState
        action={
          <Button asChild>
            <Link href={`/ads?${params.toString()}`}>
              {t("notActive.action")}
            </Link>
          </Button>
        }
        description={t("notActive.description")}
        title={t("notActive.title")}
      />
    );
  }

  return (
    <AdsErrorState
      failedTitle={t("failed.title")}
      kind={kind}
      unavailableTitle={t("unavailable.title", {
        provider: tProvider(provider),
      })}
    />
  );
}

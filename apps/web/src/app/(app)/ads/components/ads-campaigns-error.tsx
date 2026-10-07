"use client";

import type { ProjectAdProvider } from "@sokosumi/core-client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";

export type CampaignsLoadError = "not_active" | "unavailable" | "failed";

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
  const router = useRouter();

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

  if (kind === "unavailable") {
    return (
      <EmptyState
        description={t("unavailable.description")}
        title={t("unavailable.title", { provider: tProvider(provider) })}
      />
    );
  }

  return (
    <EmptyState
      action={
        <Button onClick={() => router.refresh()} type="button">
          {t("failed.retry")}
        </Button>
      }
      description={t("failed.description")}
      title={t("failed.title")}
    />
  );
}

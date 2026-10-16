"use client";

import type { ProjectAdAccount } from "@sokosumi/core-client";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { TaskFormModal } from "@/app/tasks/components/task-form-modal";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getGoogleCampaignSetup } from "@/lib/actions/ads/action";

import {
  NewGoogleCampaignWizard,
  NewMetaCampaignWizard,
} from "./ads-new-campaign-wizard";

interface AdsNewCampaignDialogProps {
  account: ProjectAdAccount;
  projectId: string;
  onClose: () => void;
}

export function AdsNewCampaignDialog({
  account,
  projectId,
  onClose,
}: AdsNewCampaignDialogProps) {
  const t = useTranslations("App.Ads.newCampaign");
  const tCampaigns = useTranslations("App.Ads.campaigns");
  const tProviders = useTranslations("App.Ads.accounts.providers");
  const [busy, setBusy] = useState(false);
  const google = account.provider === "google_ads";
  const setup = useQuery({
    queryKey: ["ads", "google-campaign-setup", projectId, account.id],
    queryFn: async () => {
      const result = await getGoogleCampaignSetup({
        projectId,
        accountId: account.id,
      });
      if (!result.ok) throw new Error(result.error.message ?? "setup failed");
      return result.value;
    },
    enabled: google,
    retry: false,
    gcTime: 0,
  });

  const accountLabel = t("inAccount", {
    provider: tProviders(account.provider),
    name: account.name,
  });
  const wizard = {
    accountId: account.id,
    accountLabel,
    currency: account.currency,
    onBusyChange: setBusy,
    onClose,
    projectId,
  };

  let body: React.ReactNode;
  if (!google) {
    body = <NewMetaCampaignWizard {...wizard} />;
  } else if (setup.data) {
    body = (
      <NewGoogleCampaignWizard
        {...wizard}
        hasMarketProfile={setup.data.hasMarketProfile}
        targeting={setup.data.targeting}
      />
    );
  } else if (setup.isError) {
    body = (
      <SetupFailed
        onRetry={() => void setup.refetch()}
        retrying={setup.isFetching}
      />
    );
  } else {
    body = <WizardSkeleton accountLabel={accountLabel} />;
  }

  return (
    <TaskFormModal
      cancelLabel={tCampaigns("cancel")}
      isDismissDisabled={busy}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
      title={t("title")}
    >
      {body}
    </TaskFormModal>
  );
}

function WizardSkeleton({ accountLabel }: { accountLabel: string }) {
  const t = useTranslations("App.Ads");

  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="flex min-h-0 flex-1 flex-col"
      data-testid="ads-new-campaign-loading"
      role="status"
    >
      <span className="sr-only">{t("loading")}</span>
      <div aria-hidden className="flex shrink-0 gap-1.5 px-6 py-4 md:px-8">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-[3px] w-full rounded-full" />
            <Skeleton className="hidden h-3 w-16 sm:block" />
          </div>
        ))}
      </div>
      <div
        aria-hidden
        className="min-h-0 flex-1 overflow-hidden border-t px-6 py-6 md:px-8 md:py-8"
      >
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 2 }, (_, index) => (
              <div
                key={index}
                className="flex flex-col gap-5 rounded-xl border p-5"
              >
                <Skeleton className="size-10 rounded-lg" />
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-4 w-full" />
                </div>
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-4 w-3/5" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 border-t px-6 py-3 md:px-8">
        <span className="text-muted-foreground truncate text-sm">
          {accountLabel}
        </span>
        <Skeleton aria-hidden className="h-10 w-28" />
      </div>
    </div>
  );
}

function SetupFailed({
  onRetry,
  retrying,
}: {
  onRetry: () => void;
  retrying: boolean;
}) {
  const t = useTranslations("App.Ads.newCampaign");

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-6 py-12 text-center">
      <p className="text-base font-semibold" role="alert">
        {t("setupFailed.title")}
      </p>
      <p className="text-muted-foreground max-w-[44ch] text-sm text-pretty">
        {t("setupFailed.body")}
      </p>
      <Button
        className="mt-3"
        loading={retrying}
        onClick={onRetry}
        type="button"
      >
        {t("setupFailed.retry")}
      </Button>
    </div>
  );
}

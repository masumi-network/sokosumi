"use client";

import type { ProjectAdAccount } from "@sokosumi/core-client";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
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

/**
 * "New campaign" as a dialog over the campaigns list, as Tasks and Schedules
 * create theirs: full screen on a phone, a centred panel from `sm`. A Google
 * wizard first loads what its steps start from (languages, the Market
 * profile's suggestions); a Meta one needs nothing and opens at once.
 *
 * A click outside never closes it, so a half-made campaign is not lost to a
 * stray click; Escape, the close button and Cancel do, except while saving.
 */
export function AdsNewCampaignDialog({
  account,
  projectId,
  onClose,
}: AdsNewCampaignDialogProps) {
  const t = useTranslations("App.Ads.newCampaign");
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
    // Each open starts from the profile as it is now.
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
        accountLabel={accountLabel}
        onClose={onClose}
        onRetry={() => void setup.refetch()}
        retrying={setup.isFetching}
      />
    );
  } else {
    body = <WizardSkeleton accountLabel={accountLabel} />;
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="bg-background top-0 left-0 grid h-dvh w-screen max-w-none! translate-x-0 translate-y-0 grid-rows-[minmax(0,1fr)] gap-0 overflow-hidden rounded-none border-0 p-0 sm:top-[50%] sm:left-[50%] sm:h-[min(820px,92dvh)] sm:w-[calc(100vw-4rem)] sm:max-w-3xl! sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-2xl sm:border [&>button]:top-5 [&>button]:right-5 sm:[&>button]:top-6 sm:[&>button]:right-6"
        data-testid="ads-new-campaign-dialog"
        onInteractOutside={(event) => event.preventDefault()}
      >
        {body}
      </DialogContent>
    </Dialog>
  );
}

/** The wizard's header, for the states before its steps are known. */
function Heading({ accountLabel }: { accountLabel: string }) {
  const t = useTranslations("App.Ads.newCampaign");

  return (
    <div className="flex flex-col gap-0.5 pr-8">
      <DialogTitle className="text-base font-semibold">
        {t("title")}
      </DialogTitle>
      <DialogDescription className="text-muted-foreground text-sm">
        {accountLabel}
      </DialogDescription>
    </div>
  );
}

/** The first step's shape while the Google setup loads: the bars and two type cards. */
function WizardSkeleton({ accountLabel }: { accountLabel: string }) {
  const t = useTranslations("App.Ads");

  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]"
      data-testid="ads-new-campaign-loading"
      role="status"
    >
      <div className="flex flex-col gap-4 px-6 pt-5 pb-4 sm:px-8 sm:pt-6">
        <Heading accountLabel={accountLabel} />
        <span className="sr-only">{t("loading")}</span>
        <div aria-hidden className="flex gap-1.5">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-[3px] w-full rounded-full" />
              <Skeleton className="hidden h-3 w-12 sm:block" />
            </div>
          ))}
        </div>
      </div>
      <div
        aria-hidden
        className="min-h-0 overflow-hidden border-t px-6 py-6 sm:px-10 sm:py-8"
      >
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
          <Skeleton className="h-6 w-48" />
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 2 }, (_, index) => (
              <div
                key={index}
                className="flex flex-col gap-4 rounded-xl border p-4"
              >
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-20" />
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
      <div
        aria-hidden
        className="flex items-center justify-between gap-3 border-t px-6 py-4 sm:px-8"
      >
        <Skeleton className="h-10 w-20" />
        <Skeleton className="h-10 w-28" />
      </div>
    </div>
  );
}

function SetupFailed({
  accountLabel,
  onClose,
  onRetry,
  retrying,
}: {
  accountLabel: string;
  onClose: () => void;
  onRetry: () => void;
  retrying: boolean;
}) {
  const t = useTranslations("App.Ads.newCampaign");
  const tCampaigns = useTranslations("App.Ads.campaigns");

  return (
    <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
      <div className="px-6 pt-5 pb-4 sm:px-8 sm:pt-6">
        <Heading accountLabel={accountLabel} />
      </div>
      <div className="flex flex-col items-center justify-center gap-1 border-t px-6 py-12 text-center">
        <p className="text-base font-semibold" role="alert">
          {t("setupFailed.title")}
        </p>
        <p className="text-muted-foreground max-w-[44ch] text-sm text-pretty">
          {t("setupFailed.body")}
        </p>
      </div>
      <div className="flex items-center justify-between gap-3 border-t px-6 py-4 sm:px-8">
        <Button onClick={onClose} type="button" variant="ghost">
          {tCampaigns("cancel")}
        </Button>
        <Button loading={retrying} onClick={onRetry} type="button">
          {t("setupFailed.retry")}
        </Button>
      </div>
    </div>
  );
}

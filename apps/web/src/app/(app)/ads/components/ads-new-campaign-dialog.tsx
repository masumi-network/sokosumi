"use client";

import type { ProjectAdAccount } from "@sokosumi/core-client";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { TaskFormModal } from "@/app/tasks/components/task-form-modal";
import { Button } from "@/components/ui/button";
import { useUnAuthenticatedErrorHandler } from "@/hooks/use-unauthenticated-error-handler";
import { getGoogleCampaignSetup } from "@/lib/actions/ads/action";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { UnAuthenticatedError } from "@/lib/auth/errors";

import {
  NewGoogleCampaignWizard,
  NewMetaCampaignWizard,
  WizardSkeleton,
} from "./ads-campaign-wizard";

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
      if (!result.ok) {
        if (result.error.code === CommonErrorCode.UNAUTHENTICATED) {
          throw new UnAuthenticatedError();
        }
        throw new Error(result.error.message ?? "setup failed");
      }
      return result.value;
    },
    enabled: google,
    retry: false,
    gcTime: 0,
  });
  const idleError = useRef(new Error("setup")).current;
  const { isUnAuthenticatedError } = useUnAuthenticatedErrorHandler(
    setup.error instanceof Error ? setup.error : idleError,
  );

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
  } else if (setup.isError && !isUnAuthenticatedError) {
    body = (
      <SetupFailed
        onRetry={() => void setup.refetch()}
        retrying={setup.isFetching}
      />
    );
  } else if (!setup.isError) {
    body = <WizardSkeleton accountLabel={accountLabel} steps={6} />;
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

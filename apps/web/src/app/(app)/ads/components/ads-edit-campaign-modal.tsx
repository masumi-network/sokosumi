"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

import { TaskFormModal } from "@/app/tasks/components/task-form-modal";
import type { GoogleFormValues } from "@/lib/ads/google-form-values";
import type { GoogleTargeting } from "@/lib/ads/targeting";

import {
  EditGoogleCampaignWizard,
  WizardSkeleton,
} from "./ads-campaign-wizard";

export interface EditCampaignData {
  accountId: string;
  accountLabel: string;
  campaignId: string;
  currency: string;
  hasMarketProfile: boolean;
  initialValues: GoogleFormValues;
  projectId: string;
  started: boolean;
  targeting: GoogleTargeting;
}

/** A Search edit's steps (no type step), the most an edit has. */
const EDIT_STEPS = 5;

type AdsEditCampaignModalProps =
  | { campaign: EditCampaignData }
  /** Why there is no wizard: a campaign Sokosumi cannot edit, or a failed load. */
  | { notice: ReactNode }
  | { loading: true };

/** Closing or saving goes back to the details, keeping project, account and range. */
export function AdsEditCampaignModal(props: AdsEditCampaignModalProps) {
  const t = useTranslations("App.Ads.editCampaign");
  const tCampaigns = useTranslations("App.Ads.campaigns");
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);

  function close(): void {
    const details = pathname.endsWith("/edit")
      ? pathname.slice(0, -"/edit".length)
      : pathname;
    router.replace(`${details}${window.location.search}`);
  }

  let body: ReactNode;
  if ("campaign" in props) {
    body = (
      <EditGoogleCampaignWizard
        {...props.campaign}
        onBusyChange={setBusy}
        onClose={close}
      />
    );
  } else if ("notice" in props) {
    body = (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-12 text-center">
        {props.notice}
      </div>
    );
  } else {
    body = <WizardSkeleton steps={EDIT_STEPS} />;
  }

  return (
    <TaskFormModal
      cancelLabel={tCampaigns("cancel")}
      isDismissDisabled={busy}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      open={pathname.endsWith("/edit")}
      title={t("title")}
    >
      {body}
    </TaskFormModal>
  );
}

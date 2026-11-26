"use client";

import type { Job } from "@sokosumi/core-client";
import { SokosumiJobStatus } from "@sokosumi/core-client";
import { CircleAlert, type LucideIcon, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import RequestRefundButton, { canRenderRefundRequest } from "./refund-request";

const NOTICES: Partial<
  Record<
    SokosumiJobStatus,
    { key: "failed" | "paymentFailed" | "refunded"; Icon: LucideIcon }
  >
> = {
  [SokosumiJobStatus.FAILED]: { key: "failed", Icon: CircleAlert },
  [SokosumiJobStatus.PAYMENT_FAILED]: {
    key: "paymentFailed",
    Icon: CircleAlert,
  },
  [SokosumiJobStatus.REFUND_RESOLVED]: { key: "refunded", Icon: RotateCcw },
};

/**
 * Says in words what a failed, unpaid or refunded job's status means. A
 * failed job otherwise shows only a status badge, and its refund is out of
 * reach. The copy claims only what the status itself proves: several on-chain
 * outcomes map to each status, a failed job can still hold an earlier result,
 * and the status says nothing about when credits reach the ledger.
 */
export function JobStatusNotice({
  job,
  canManage,
}: {
  job: Job;
  canManage: boolean;
}) {
  const t = useTranslations("Components.Jobs.JobDetails.StatusNotice");
  const notice = NOTICES[job.status];
  if (!notice) {
    return null;
  }

  const { key, Icon } = notice;
  const refundJob =
    canManage &&
    job.status === SokosumiJobStatus.FAILED &&
    canRenderRefundRequest(job)
      ? job
      : null;

  return (
    // A note, not an alert: it describes a past job, so nothing is announced.
    <Alert role="note">
      <Icon aria-hidden />
      <AlertTitle>{t(`${key}.title`)}</AlertTitle>
      <AlertDescription>
        <p>{t(`${key}.description`)}</p>
        {refundJob ? <RequestRefundButton initialJob={refundJob} /> : null}
      </AlertDescription>
    </Alert>
  );
}

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
 * Says in words why a job has no result. A failed job otherwise shows only a
 * status badge and an empty activity row, and its refund is out of reach.
 * The copy claims only what the status proves: several on-chain outcomes map
 * to each status, so it never says what the agent did.
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

  const { Icon } = notice;
  // Core marks a job refunded when the on-chain refund lands; the credits are
  // back only once the ledger catches up (`jobStatusSettled`).
  const key =
    notice.key === "refunded" && !job.jobStatusSettled
      ? "refundPending"
      : notice.key;
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

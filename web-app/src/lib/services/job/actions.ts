"use server";

import { getSessionOrThrow } from "@/lib/auth/utils";
import { getJobById, setNextActionToJob } from "@/lib/db/job/repo";
import { JobWithStatus } from "@/lib/db/job/types";
import { NextJobAction } from "@/prisma/generated/client/default";

import { postPaymentClientRequestRefund } from "./third-party";

export async function requestRefundJob(
  jobBlockchainIdentifier: string,
): Promise<JobWithStatus> {
  const session = await getSessionOrThrow();
  const userId = session.user.id;
  const job = await getJobById(jobBlockchainIdentifier);
  if (!job) {
    throw new Error("Job not found");
  }
  if (job.userId !== userId) {
    throw new Error("Unauthorized");
  }
  const refundResult = await postPaymentClientRequestRefund(
    jobBlockchainIdentifier,
  );
  if (!refundResult.ok) {
    throw new Error(refundResult.error);
  }
  const updatedJob = await setNextActionToJob(
    jobBlockchainIdentifier,
    NextJobAction.SET_REFUND_REQUESTED_REQUESTED,
  );
  return updatedJob;
}

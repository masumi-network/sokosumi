import * as Sentry from "@sentry/node";
import { jobPurchaseRepository } from "@sokosumi/database/repositories";
import type { PurchaseFailure } from "@sokosumi/masumi";
import type {
  InputSchemaType,
  StartPaidJobResponseSchemaType,
} from "@sokosumi/masumi/schemas";
import { paymentClient } from "@/clients/masumi-payment.client";
import { transformPurchaseToJobUpdate } from "@/helpers/purchase";
import prisma from "@/lib/db/prisma";

/**
 * How many times the hire path posts the purchase before it gives up.
 *
 * The purchase is only registered here. Job sync can adopt a purchase the node
 * already holds, but it never posts one, so a `POST /purchase` the node never
 * accepted is never retried anywhere else.
 */
export const PURCHASE_REGISTRATION_ATTEMPTS = 3;

/**
 * Backoff before attempt N+1, indexed from the attempt that just failed.
 *
 * Deliberately short: a user is waiting on this HTTP request. The budget covers
 * a dropped connection or a node restarting behind a proxy, not a node that is
 * down for minutes.
 */
const PURCHASE_REGISTRATION_BACKOFF_MS = [250, 1000];

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Backoff after the attempt that just failed, holding at the last step. */
function backoffMsFor(failedAttempt: number): number {
  return (
    PURCHASE_REGISTRATION_BACKOFF_MS[failedAttempt - 1] ??
    PURCHASE_REGISTRATION_BACKOFF_MS.at(-1) ??
    0
  );
}

export interface RegisterJobPurchaseParams {
  jobId: string;
  agentId: string;
  agentBlockchainIdentifier: string;
  startJobResponse: StartPaidJobResponseSchemaType;
  inputData: InputSchemaType;
  identifierFromPurchaser: string;
  amounts?: Array<{ amount: string; unit: string }>;
}

export interface RegisterJobPurchaseOptions {
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Registers the on-chain purchase for a job that has already been created
 * locally, and stores the node's answer.
 *
 * Retrying is safe because the node answers a repeat post with 409 and the
 * client resolves the existing purchase, so an attempt whose response was lost
 * converges on the same row instead of creating a second one. Only an
 * `ambiguous` failure is retried; a `permanent` one is the node refusing this
 * exact payload and will be refused identically every time.
 *
 * The job survives a failure here. It carries no purchase, so it follows the
 * payment-failed credit-refund path.
 */
export async function registerJobPurchase(
  params: RegisterJobPurchaseParams,
  options: RegisterJobPurchaseOptions = {},
): Promise<void> {
  const sleep = options.sleep ?? sleepMs;

  let failure: PurchaseFailure | undefined;
  let attemptsMade = 0;

  for (
    let attempt = 1;
    attempt <= PURCHASE_REGISTRATION_ATTEMPTS;
    attempt += 1
  ) {
    attemptsMade = attempt;
    const result = await paymentClient().createPurchase(
      params.agentBlockchainIdentifier,
      params.startJobResponse,
      params.inputData,
      params.identifierFromPurchaser,
      params.amounts,
    );

    if (result.isOk()) {
      const purchaseData = transformPurchaseToJobUpdate(result.value);
      await jobPurchaseRepository
        .createJobPurchase({ jobId: params.jobId, ...purchaseData }, prisma)
        .catch((error) => {
          Sentry.captureException(error);
        });
      return;
    }

    failure = result.error;
    if (failure.kind === "permanent") {
      break;
    }
    if (attempt < PURCHASE_REGISTRATION_ATTEMPTS) {
      await sleep(backoffMsFor(attempt));
    }
  }

  if (failure === undefined) {
    return;
  }

  if (failure.kind === "permanent") {
    // A permanent rejection is not transient. With the Amounts guard it most
    // likely means on-chain pricing drifted from the synced pricing the credits
    // charge used.
    Sentry.captureException(
      new Error(
        `Purchase rejected by payment node (likely price drift) for agent ${params.agentId}: ${failure.message}`,
      ),
    );
  } else {
    // A single transient failure stays quiet (SOKOSUMI-CORE-2N): the retries
    // above absorb it. Reaching this line means every attempt failed, which is
    // an outage rather than a blip, and nothing downstream will register this
    // purchase later.
    Sentry.captureException(
      new Error(
        `Purchase registration failed after ${PURCHASE_REGISTRATION_ATTEMPTS} attempts for agent ${params.agentId}: ${failure.message}`,
      ),
    );
  }

  console.warn("[registerJobPurchase] purchase registration failed", {
    jobId: params.jobId,
    agentId: params.agentId,
    attempts: attemptsMade,
    kind: failure.kind,
    error: failure.message,
  });
}

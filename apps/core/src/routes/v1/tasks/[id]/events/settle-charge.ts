import type { z } from "@hono/zod-openapi";
import type { Prisma, TaskStatus } from "@sokosumi/database";
import { convertCentsToCredits, convertCreditsToCents } from "@sokosumi/utils";

import { LIMITS } from "@/config/constants";
import {
  getCardanoV2ReadySources,
  getCreditCostsOrThrow,
  isCardanoV2SourceReady,
} from "@/helpers/agent";
import { calculateCentsFromMasumiAmountStrings } from "@/helpers/agent-cost";
import { unprocessableEntity } from "@/helpers/error";
import { isV2MasumiTaskPayment } from "@/helpers/masumi-task-payment";
import { chargeTaskCreditsOrMarkOutOfCredits } from "@/helpers/task-event-charge";
import type { createTaskEventRequestSchema } from "./schema";

interface SettleTaskEventChargeParams {
  task: {
    ownerId: string | null;
    organizationId: string | null;
    projectId: string | null;
    status: TaskStatus;
  };
  credits?: number | null;
  masumiPayment?: z.infer<
    ReturnType<typeof createTaskEventRequestSchema>
  >["masumiPayment"];
  tx: Prisma.TransactionClient;
}

interface SettleTaskEventChargeResult {
  cents: bigint | undefined;
  transactionId: string | null;
  /** When set, charge failed for balance and status was replaced. */
  eventStatus: TaskStatus | null;
  chargedMasumiPayment: boolean;
}

export async function settleTaskEventCharge({
  task,
  credits,
  masumiPayment,
  tx,
}: SettleTaskEventChargeParams): Promise<SettleTaskEventChargeResult> {
  if (masumiPayment) {
    console.info("[tasks] masumi task payment: using masumiPayment", {
      masumiPayment,
    });
    // V2 payments are gated exactly like the job flow: a payment node that
    // recently reported the payload's EXACT policy/contract source as
    // purchase-ready. Rejecting before the charge avoids a pointless
    // debit/refund cycle; unexpected node rejection is compensated below.
    const isV2TaskPayment = isV2MasumiTaskPayment(masumiPayment);
    if (isV2TaskPayment) {
      const readySources = await getCardanoV2ReadySources(tx);
      if (readySources.length === 0) {
        throw unprocessableEntity(
          "Cardano V2 payments are not enabled on this deployment",
        );
      }
      const paymentSource = masumiPayment.PaymentSource;
      if (!paymentSource) {
        throw unprocessableEntity(
          "V2 masumi payments must include PaymentSource with the seller's policyId and smartContractAddress",
        );
      }
      // Same matcher as the job flow. isCardanoV2SourceReady lowercases both
      // sides, so a mixed-case address or identifier from the node still
      // matches a purchase-ready source.
      const isSourceReady = isCardanoV2SourceReady(
        masumiPayment.agentIdentifier,
        paymentSource.smartContractAddress,
        readySources,
      );
      if (!isSourceReady) {
        throw unprocessableEntity(
          "The selected Cardano V2 payment source is not purchase-ready on this deployment",
        );
      }
    }
    const creditCosts = await getCreditCostsOrThrow(tx);
    const cents = calculateCentsFromMasumiAmountStrings(
      masumiPayment.Amounts,
      creditCosts,
    );
    if (cents === 0n) {
      throw unprocessableEntity(
        `Credit amount rounds to zero; minimum chargeable amount is ${LIMITS.MIN_CHARGEABLE_CREDITS} credits`,
      );
    }
    const creditsValue = convertCentsToCredits(cents);
    if (creditsValue < LIMITS.MIN_CHARGEABLE_CREDITS) {
      throw unprocessableEntity(
        `Credit amount is below the minimum chargeable value (${LIMITS.MIN_CHARGEABLE_CREDITS})`,
      );
    }
    const charge = await chargeTaskCreditsOrMarkOutOfCredits({
      userId: task.ownerId,
      organizationId: task.organizationId,
      projectId: task.projectId,
      cents,
      currentStatus: task.status,
      tx,
    });
    if (charge.eventStatus != null) {
      return {
        cents,
        transactionId: null,
        eventStatus: charge.eventStatus,
        chargedMasumiPayment: false,
      };
    }
    return {
      cents,
      transactionId: charge.transactionId,
      eventStatus: null,
      chargedMasumiPayment: true,
    };
  }

  if (credits != null && credits > 0) {
    const cents = convertCreditsToCents(credits);
    if (cents === 0n) {
      throw unprocessableEntity(
        `Credit amount rounds to zero; minimum chargeable amount is ${LIMITS.MIN_CHARGEABLE_CREDITS} credits`,
      );
    }
    const charge = await chargeTaskCreditsOrMarkOutOfCredits({
      userId: task.ownerId,
      organizationId: task.organizationId,
      projectId: task.projectId,
      cents,
      currentStatus: task.status,
      tx,
    });
    if (charge.eventStatus != null) {
      return {
        cents,
        transactionId: null,
        eventStatus: charge.eventStatus,
        chargedMasumiPayment: false,
      };
    }
    return {
      cents,
      transactionId: charge.transactionId,
      eventStatus: null,
      chargedMasumiPayment: false,
    };
  }

  return {
    cents: undefined,
    transactionId: null,
    eventStatus: null,
    chargedMasumiPayment: false,
  };
}

import type { Prisma } from "@sokosumi/database";
import {
  convertCreditsToCents,
  feeFromCentsBasedOnPercentagePoints,
  roundUpCentsWithFee,
} from "@sokosumi/database/helpers";
import {
  type Consumption,
  creditBucketRepository,
} from "@sokosumi/database/repositories";

import { CREDIT } from "@/config/constants";

import { badRequest } from "./error";

interface CreateTaskCompletionTransactionInput {
  userId: string;
  credits: number;
  tx: Prisma.TransactionClient;
}

export async function createTaskCompletionTransaction(
  input: CreateTaskCompletionTransactionInput,
): Promise<string | null> {
  if (input.credits === 0) {
    return null;
  }

  const cents = convertCreditsToCents(input.credits);

  let consumptions: Consumption[] | undefined;
  try {
    consumptions = await creditBucketRepository.prepareConsumption(
      input.userId,
      null,
      cents,
      input.tx,
    );
  } catch {
    consumptions = undefined;
  }
  if (consumptions === undefined) {
    throw badRequest("Insufficient balance");
  }

  const fee = feeFromCentsBasedOnPercentagePoints(
    cents,
    CREDIT.FEE_PERCENTAGE_POINTS,
  );
  const { cents: amount, includedFee } = roundUpCentsWithFee(cents, fee);

  const transaction = await input.tx.transaction.create({
    data: {
      amount: amount * BigInt(-1),
      includedFee,
      user: { connect: { id: input.userId } },
      creditConsumptions: {
        createMany: {
          data: consumptions.map((consumption) => ({
            bucketId: consumption.bucketId,
            amount: consumption.amount,
          })),
        },
      },
    },
    select: {
      id: true,
    },
  });

  return transaction.id;
}

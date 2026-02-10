import type { Prisma } from "@sokosumi/database";
import { convertCreditsToCents } from "@sokosumi/database/helpers";
import {
  type Consumption,
  creditBucketRepository,
} from "@sokosumi/database/repositories";

import { badRequest } from "./error";

interface CreateTaskEventTransactionInput {
  userId: string;
  organizationId: string | null;
  credits: number;
  tx: Prisma.TransactionClient;
}

export async function createTaskEventTransaction(
  input: CreateTaskEventTransactionInput,
): Promise<string | null> {
  if (input.credits === 0) {
    return null;
  }

  const cents = convertCreditsToCents(input.credits);

  let consumptions: Consumption[];
  try {
    consumptions = await creditBucketRepository.prepareConsumption(
      input.userId,
      input.organizationId,
      cents,
      input.tx,
    );
  } catch (error) {
    if (error instanceof Error) {
      throw badRequest(error.message);
    }
    throw error;
  }

  const transaction = await input.tx.transaction.create({
    data: {
      amount: cents * BigInt(-1),
      user: { connect: { id: input.userId } },
      ...(input.organizationId
        ? { organization: { connect: { id: input.organizationId } } }
        : {}),
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

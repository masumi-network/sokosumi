import type { Prisma } from "@sokosumi/database";
import {
  type Consumption,
  creditBucketRepository,
} from "@sokosumi/database/repositories";

import { unprocessableEntity } from "./error";

interface CreateTaskEventTransactionInput {
  userId: string;
  organizationId: string | null;
  cents: bigint;
  tx: Prisma.TransactionClient;
}

export async function createTaskEventTransaction(
  input: CreateTaskEventTransactionInput,
): Promise<string | null> {
  if (input.cents === 0n) {
    return null;
  }

  let consumptions: Consumption[];
  try {
    consumptions = await creditBucketRepository.prepareConsumption(
      input.userId,
      input.organizationId,
      input.cents,
      input.tx,
    );
  } catch (error) {
    if (error instanceof Error) {
      throw unprocessableEntity(error.message);
    }
    throw error;
  }

  const transaction = await input.tx.transaction.create({
    data: {
      amount: input.cents * BigInt(-1),
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

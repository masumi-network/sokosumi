import type { Prisma } from "@sokosumi/database";
import {
  type Consumption,
  creditBucketRepository,
  InsufficientBalanceError,
} from "@sokosumi/database/repositories";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";

import { unprocessableEntity } from "./error";

interface CreateTaskEventTransactionInput {
  userId: string;
  organizationId: string | null;
  cents: bigint;
  tx: Prisma.TransactionClient;
}

export function isInsufficientBalanceError(error: unknown): boolean {
  if (!(error instanceof HTTPException) || error.status !== 422) {
    return false;
  }

  const cause = error.cause;
  return (
    typeof cause === "object" &&
    cause !== null &&
    "kind" in cause &&
    cause.kind === CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE
  );
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
    if (error instanceof InsufficientBalanceError) {
      throw unprocessableEntity(error.message, {
        kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE,
      });
    }
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

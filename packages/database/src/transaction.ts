import "server-only";

import prisma from "./client";
import type { Prisma } from "./generated/prisma/client";

/**
 * Transaction builder interface that provides access to Prisma transactions
 * without exposing the entire Prisma client singleton.
 */
export const transaction = {
  /**
   * Execute code in an interactive transaction.
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/transactions#interactive-transactions
   */
  run: prisma.$transaction.bind(prisma),
} as const;

// Re-export TransactionClient type for repository signatures
export type { Prisma };
export type TransactionClient = Prisma.TransactionClient;

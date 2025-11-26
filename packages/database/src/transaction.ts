import prisma from "./client.js";
import type { Prisma } from "./generated/prisma/client.js";

/**
 * Transaction builder interface that provides access to Prisma transactions
 * without exposing the entire Prisma client singleton.
 *
 * ## Usage:
 *
 * ### Basic transaction:
 * ```typescript
 * import { transaction } from '@sokosumi/database/transaction'
 * import { userRepository } from '@sokosumi/database/repositories'
 *
 * await transaction.run(async (tx) => {
 *   await userRepository.getUserById('user-id', tx)
 *   // ... more operations
 * })
 * ```
 *
 * ### With TypeScript types:
 * ```typescript
 * import { transaction, type TransactionClient } from '@sokosumi/database/transaction'
 *
 * async function myOperation(tx: TransactionClient) {
 *   // ... operations using tx
 * }
 * ```
 *
 * @see https://www.prisma.io/docs/concepts/components/prisma-client/transactions#interactive-transactions
 */
export const transaction = {
  /**
   * Execute code in an interactive transaction.
   * All operations within the callback will be executed atomically.
   *
   * @example
   * ```typescript
   * await transaction.run(async (tx) => {
   *   const user = await tx.user.findUnique({ where: { id: userId } })
   *   await tx.job.create({ data: { userId, ... } })
   * })
   * ```
   */
  run: prisma.$transaction.bind(prisma),
} as const;

// Re-export Prisma namespace and TransactionClient type for repository signatures
export type { Prisma };

/**
 * Prisma TransactionClient type for use in repository method signatures.
 * This allows repositories to accept either the main Prisma client or a transaction client.
 */
export type TransactionClient = Prisma.TransactionClient;

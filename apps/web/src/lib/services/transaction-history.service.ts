import "server-only";

import { coreClient } from "@/lib/clients/core.client";
import type {
  GetTransactionsData,
  TransactionHistoryItem,
} from "@/lib/clients/generated/core/types.gen";

type TransactionHistoryQuery = NonNullable<GetTransactionsData["query"]>;

export interface ListTransactionHistoryParams {
  cursor?: string | null;
  limit?: number;
}

export type { TransactionHistoryItem };

function toTransactionDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapTransactionHistoryItem(
  item: TransactionHistoryItem,
): TransactionHistoryItem {
  return {
    ...item,
    createdAt: toTransactionDate(item.createdAt),
  };
}

export const transactionHistoryService = (() => {
  async function listTransactionHistory(
    params: ListTransactionHistoryParams = {},
  ): Promise<{
    transactions: TransactionHistoryItem[];
    pagination: {
      cursor: string | null;
      limit: number;
      total: number;
      nextCursor: string | null;
    } | null;
  }> {
    const query: TransactionHistoryQuery = {
      cursor: params.cursor ?? undefined,
      limit: params.limit,
    };
    const result = await coreClient.getTransactions(query);

    return {
      transactions: result.data.map(mapTransactionHistoryItem),
      pagination: result.meta?.pagination ?? null,
    };
  }

  return {
    listTransactionHistory,
  };
})();

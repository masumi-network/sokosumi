import "server-only";

import { coreClient } from "@/lib/clients/core.client";
import type {
  GetTransactionsData,
  TransactionHistoryItem,
} from "@/lib/clients/generated/core/types.gen";

type TransactionQuery = NonNullable<GetTransactionsData["query"]>;

export interface ListHistoryParams {
  cursor?: string | null;
  limit?: number;
  projectId?: TransactionQuery["projectId"];
  q?: TransactionQuery["q"];
  scope?: TransactionQuery["scope"];
  types?: TransactionQuery["types"];
}

export type { TransactionHistoryItem };

function toHistoryDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapHistoryItem(item: TransactionHistoryItem): TransactionHistoryItem {
  return {
    ...item,
    consumedAt: toHistoryDate(item.consumedAt),
  };
}

/**
 * The credit ledger behind Transaction History.
 *
 * `GET /v1/transactions`, not `GET /v1/history`: the feed endpoint still backs
 * the Cmd+K palette, which has to find a task or a job that never charged.
 */
export const historyService = (() => {
  async function listHistory(params: ListHistoryParams = {}): Promise<{
    history: TransactionHistoryItem[];
    pagination: {
      cursor: string | null;
      limit: number;
      total: number;
      nextCursor: string | null;
    } | null;
  }> {
    const result = await coreClient.getTransactions({
      cursor: params.cursor ?? undefined,
      limit: params.limit,
      projectId: params.projectId,
      q: params.q,
      scope: params.scope,
      types: params.types,
    });

    return {
      history: result.data.map(mapHistoryItem),
      pagination: result.meta?.pagination ?? null,
    };
  }

  return {
    listHistory,
  };
})();

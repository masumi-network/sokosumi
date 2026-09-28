import "server-only";

import { coreClient } from "@/lib/clients/core.client";
import type {
  GetHistoryData,
  TransactionHistoryItem,
} from "@/lib/clients/generated/core/types.gen";

type HistoryQuery = NonNullable<GetHistoryData["query"]>;

export interface ListHistoryParams {
  cursor?: string | null;
  limit?: number;
  projectId?: HistoryQuery["projectId"];
  q?: HistoryQuery["q"];
  scope?: HistoryQuery["scope"];
  types?: HistoryQuery["types"];
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
    const result = await coreClient.getHistory({
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

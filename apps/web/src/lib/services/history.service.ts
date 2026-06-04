import "server-only";

import { coreClient } from "@/lib/clients/core.client";
import type {
  GetHistoryData,
  HistoryItem,
} from "@/lib/clients/generated/core/types.gen";

type HistoryQuery = NonNullable<GetHistoryData["query"]>;

export interface ListHistoryParams {
  cursor?: string | null;
  limit?: number;
  projectId?: HistoryQuery["projectId"];
  q?: HistoryQuery["q"];
  scope?: HistoryQuery["scope"];
  status?: HistoryQuery["status"];
  types?: HistoryQuery["types"];
}

export type { HistoryItem };

function toHistoryDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapHistoryItem(item: HistoryItem): HistoryItem {
  return {
    ...item,
    updatedAt: toHistoryDate(item.updatedAt),
  };
}

export const historyService = (() => {
  async function listHistory(params: ListHistoryParams = {}): Promise<{
    history: HistoryItem[];
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
      status: params.status,
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

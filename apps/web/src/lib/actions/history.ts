"use server";

import { err, ok, type Result } from "neverthrow";

import type {
  HistoryItem,
  ListHistoryParams,
} from "@/lib/services/history.service";
import { historyService } from "@/lib/services/history.service";

interface ListHistoryResult {
  history: HistoryItem[];
  pagination: {
    cursor: string | null;
    limit: number;
    total: number;
    nextCursor: string | null;
  } | null;
}

export async function listHistoryAction(
  params: ListHistoryParams = {},
): Promise<Result<ListHistoryResult, string>> {
  try {
    const result = await historyService.listHistory(params);
    return ok(result);
  } catch {
    return err("Failed to fetch history");
  }
}

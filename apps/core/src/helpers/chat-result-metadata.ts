import { CHAT_RESULT_PREVIEW_LIMIT } from "@sokosumi/soko-bot";
import {
  type ChatResultSnapshot,
  chatResultSnapshotSchema,
} from "@/schemas/chat-result-preview.schema";

export const RESULT_SNAPSHOTS_KEY = "result_preview_snapshots";
export function readChatResultSnapshots(value: unknown): ChatResultSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, CHAT_RESULT_PREVIEW_LIMIT).flatMap((item) => {
    const parsed = chatResultSnapshotSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export function chatResultDescriptors(value: unknown) {
  return readChatResultSnapshots(value).map(({ data }) => ({
    id: data.id,
    capturedAt: data.capturedAt,
  }));
}

/** Prepared tool calls and message metadata must expose the same bounded collection. */
export function readPreparedResultSnapshots(
  results: unknown[],
): ChatResultSnapshot[] {
  const seen = new Set<string>();
  const snapshots: ChatResultSnapshot[] = [];
  for (const result of results.slice(0, 24)) {
    const parsed = chatResultSnapshotSchema.safeParse(result);
    if (!parsed.success) continue;
    const ref = parsed.data.reference;
    const key = `${ref.kind}:${ref.id}:${"projectId" in ref ? ref.projectId : ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    snapshots.push(parsed.data);
    if (snapshots.length === CHAT_RESULT_PREVIEW_LIMIT) break;
  }
  return snapshots;
}

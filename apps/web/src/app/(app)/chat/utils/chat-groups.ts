import type { Conversation } from "@/lib/actions/conversation";

import {
  displaySlugFromMetadata,
  getBucketKeyFromMetadata,
  slugify,
} from "./bucket-slug";

export interface ChatGroup {
  key: string;
  displayName: string;
  displaySlug: string;
  modelId: string | null;
  modelName: string | null;
  coworkerId: string | null;
  coworkerName: string | null;
  conversations: Conversation[];
  latestUpdatedAt: number;
}

export function buildChatGroups(
  conversations: Conversation[],
  untitledLabel: string,
): ChatGroup[] {
  const byKey = new Map<
    string,
    {
      displayName: string;
      modelId: string | null;
      modelName: string | null;
      coworkerId: string | null;
      coworkerName: string | null;
      conversations: Conversation[];
    }
  >();

  for (const conv of conversations) {
    const meta = (conv.metadata as Record<string, unknown> | null) ?? null;
    const key = getBucketKeyFromMetadata(meta);
    const modelId =
      (meta?.model_id as string | undefined) ??
      (meta?.modelId as string | undefined) ??
      null;
    const modelName =
      (meta?.model_name as string | undefined) ??
      (meta?.modelName as string | undefined) ??
      null;
    const coworkerId =
      (meta?.coworker_id as string | undefined) ??
      (meta?.coworkerId as string | undefined) ??
      null;
    const coworkerName =
      (meta?.coworker_name as string | undefined) ??
      (meta?.coworkerName as string | undefined) ??
      null;
    const isCoworkerConversation = key.startsWith("coworker:");
    const displayName = isCoworkerConversation
      ? (coworkerName ?? untitledLabel)
      : (modelName ?? untitledLabel);

    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        displayName,
        modelId: isCoworkerConversation ? null : modelId,
        modelName: isCoworkerConversation ? null : modelName,
        coworkerId: isCoworkerConversation ? coworkerId : null,
        coworkerName,
        conversations: [],
      };
      byKey.set(key, entry);
    }
    entry.conversations.push(conv);
  }

  const groups: ChatGroup[] = [];
  for (const [key, entry] of byKey) {
    const sorted = [...entry.conversations].sort((a, b) => {
      const ta = new Date(a.updatedAt).getTime();
      const tb = new Date(b.updatedAt).getTime();
      return tb - ta;
    });
    const firstMeta =
      (sorted[0]?.metadata as Record<string, unknown> | null) ?? null;
    const displaySlug =
      displaySlugFromMetadata(firstMeta) || slugify(entry.displayName) || key;
    const latestUpdatedAt =
      sorted.length > 0 ? new Date(sorted[0].updatedAt).getTime() : 0;
    groups.push({
      key,
      displayName: entry.displayName,
      displaySlug,
      modelId: entry.modelId,
      modelName: entry.modelName,
      coworkerId: entry.coworkerId,
      coworkerName: entry.coworkerName,
      conversations: sorted,
      latestUpdatedAt,
    });
  }
  groups.sort((a, b) => b.latestUpdatedAt - a.latestUpdatedAt);
  return groups;
}

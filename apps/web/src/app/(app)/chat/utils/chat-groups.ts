import type { Conversation } from "@/lib/actions/conversation";

import {
  displaySlugFromMetadata,
  getBucketKeyFromMetadata,
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

  for (const conversation of conversations) {
    const metadata =
      (conversation.metadata as Record<string, unknown> | null) ?? null;
    const key = getBucketKeyFromMetadata(metadata);
    const modelId =
      (metadata?.model_id as string | undefined) ??
      (metadata?.modelId as string | undefined) ??
      null;
    const modelName =
      (metadata?.model_name as string | undefined) ??
      (metadata?.modelName as string | undefined) ??
      null;
    const coworkerId =
      (metadata?.coworker_slug as string | undefined) ??
      (metadata?.coworkerSlug as string | undefined) ??
      (metadata?.coworker_id as string | undefined) ??
      (metadata?.coworkerId as string | undefined) ??
      null;
    const coworkerName =
      (metadata?.coworker_name as string | undefined) ??
      (metadata?.coworkerName as string | undefined) ??
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

    entry.conversations.push(conversation);
  }

  const groups: ChatGroup[] = [];

  for (const [key, entry] of byKey) {
    const sortedConversations = [...entry.conversations].sort((a, b) => {
      const firstUpdatedAt = new Date(a.updatedAt).getTime();
      const secondUpdatedAt = new Date(b.updatedAt).getTime();

      return secondUpdatedAt - firstUpdatedAt;
    });
    const firstMetadata =
      (sortedConversations[0]?.metadata as Record<string, unknown> | null) ??
      null;
    const displaySlug = displaySlugFromMetadata(firstMetadata) || key;
    const latestUpdatedAt =
      sortedConversations.length > 0
        ? new Date(sortedConversations[0].updatedAt).getTime()
        : 0;

    groups.push({
      key,
      displayName: entry.displayName,
      displaySlug,
      modelId: entry.modelId,
      modelName: entry.modelName,
      coworkerId: entry.coworkerId,
      coworkerName: entry.coworkerName,
      conversations: sortedConversations,
      latestUpdatedAt,
    });
  }

  groups.sort((firstGroup, secondGroup) => {
    return secondGroup.latestUpdatedAt - firstGroup.latestUpdatedAt;
  });

  return groups;
}

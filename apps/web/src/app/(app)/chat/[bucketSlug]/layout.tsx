"use client";

import { useParams, usePathname } from "next/navigation";
import { useMemo } from "react";

import { ChatConversationsSidebar } from "@/app/chat/components/chat-conversations-sidebar";
import {
  bucketKeyFromDisplaySlug,
  slugify,
  slugToBucketKey,
} from "@/app/chat/utils/bucket-slug";
import { useConversationsContext } from "@/contexts/conversations-context";
import { useCoworkersContext } from "@/contexts/coworkers-context";

const PENDING_CONVERSATION_KEY = "chat-pending-conversation-id";
const SHOW_SECONDARY_SIDEBAR_KEY = "chat-show-secondary-sidebar";

function getConversationIdFromPathname(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "chat" || segments[2] !== "conversation" || !segments[3])
    return null;
  return segments[3] ?? null;
}

function getShowSecondarySidebar(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(SHOW_SECONDARY_SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

type ConversationMetadata = {
  coworker_id?: string;
  coworker_name?: string;
  model_id?: string;
  model_name?: string;
};

function getGroupKey(metadata: ConversationMetadata | null): string {
  if (!metadata) return "other";
  if (metadata.model_id) return `model:${metadata.model_id}`;
  if (metadata.coworker_id) return `coworker:${metadata.coworker_id}`;
  return "other";
}

export default function ChatBucketLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams<{ bucketSlug: string }>();
  const bucketSlug = params?.bucketSlug;
  const { conversations } = useConversationsContext();
  const { coworkers } = useCoworkersContext();

  const bucket = useMemo(() => {
    if (!bucketSlug) return null;
    const fromConversations = bucketKeyFromDisplaySlug(
      conversations,
      bucketSlug,
    );
    if (fromConversations) return fromConversations;
    const slugLower = bucketSlug.trim().toLowerCase();
    const coworker = coworkers?.find(
      (c) =>
        (c.slug && slugify(c.slug) === slugLower) ||
        (c.name && slugify(c.name) === slugLower),
    );
    if (coworker) return `coworker:${coworker.id}`;
    return slugToBucketKey(bucketSlug) || null;
  }, [bucketSlug, conversations, coworkers]);

  const bucketData = useMemo(() => {
    if (!bucket) return null;
    const list = conversations.filter((c) => {
      const meta = (c.metadata as ConversationMetadata | null) ?? null;
      return getGroupKey(meta) === bucket;
    });
    const meta =
      list.length > 0
        ? ((list[0].metadata as ConversationMetadata | null) ?? null)
        : null;
    const displayName =
      meta?.model_name ?? meta?.coworker_name ?? bucket ?? "Chat";
    return { displayName, conversations: list };
  }, [bucket, conversations]);

  const pathname = usePathname();
  const isJustCreatedConversation =
    typeof window !== "undefined" &&
    (() => {
      const conversationId = getConversationIdFromPathname(pathname ?? "");
      if (!conversationId) return false;
      try {
        return (
          sessionStorage.getItem(PENDING_CONVERSATION_KEY) === conversationId
        );
      } catch {
        return false;
      }
    })();

  const showSidebar = getShowSecondarySidebar() && !isJustCreatedConversation;

  return (
    <div className="flex h-full w-full flex-col">
      <div className="-mt-20 -mb-4 flex min-h-[calc(100svh-64px)] w-full flex-col gap-4 md:-mt-4 lg:flex-row lg:items-stretch">
        {showSidebar && (
          <div className="w-full px-4 lg:sticky lg:top-16 lg:h-[calc(100svh-64px)] lg:w-72 lg:flex-none">
            <ChatConversationsSidebar
              bucketSlug={bucketSlug ?? ""}
              bucket={bucket ?? ""}
              displayName={bucketData?.displayName ?? bucketSlug ?? "Chat"}
              conversations={bucketData?.conversations ?? []}
            />
          </div>
        )}
        <div className="h-full min-h-0 min-w-0 flex-1 pt-20 pb-4 md:pt-4">
          <div className="mx-auto h-full min-h-0 w-full px-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

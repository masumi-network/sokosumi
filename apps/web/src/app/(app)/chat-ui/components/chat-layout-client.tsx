"use client";

import { usePathname } from "next/navigation";
import { useMemo } from "react";
import {
  getBucketKeyFromMetadata,
  resolveBucketKeyFromDisplaySlug,
} from "@/app/chat/utils/bucket-slug";
import { ChatConversationsSidebar } from "@/app/chat-ui/components/chat-conversations-sidebar";
import ChatInterface from "@/app/chat-ui/components/chat-interface";
import {
  getBucketSlugFromChatPathname,
  getConversationIdFromChatPathname,
  getPendingConversationStorageKey,
} from "@/app/chat-ui/utils/chat-route-base";
import { useConversationsContext } from "@/contexts/conversations-context";
import { useCoworkersContext } from "@/contexts/coworkers-context";
import type { TaskDesignMdAttachmentSeed } from "@/lib/utils/task-attachments";

interface ChatLayoutClientProps {
  mobileKeyboardOptimized?: boolean;
  organizationSlug: string | null;
  userImageUrl: string;
  userName: string | undefined;
  initialDesignMdAttachment?: TaskDesignMdAttachmentSeed | null;
}

export function ChatLayoutClient({
  mobileKeyboardOptimized = false,
  organizationSlug,
  userImageUrl,
  userName,
  initialDesignMdAttachment = null,
}: ChatLayoutClientProps) {
  const pathname = usePathname();
  const { conversations } = useConversationsContext();
  const { coworkers } = useCoworkersContext();

  const pendingConversationKey = getPendingConversationStorageKey();
  const bucketSlug = useMemo(
    () => getBucketSlugFromChatPathname(pathname ?? ""),
    [pathname],
  );
  const conversationIdFromPath = useMemo(
    () => getConversationIdFromChatPathname(pathname ?? ""),
    [pathname],
  );

  const isJustCreatedConversation =
    typeof window !== "undefined" &&
    (() => {
      if (!conversationIdFromPath) return false;
      try {
        return (
          sessionStorage.getItem(pendingConversationKey) ===
          conversationIdFromPath
        );
      } catch {
        return false;
      }
    })();

  const showSecondarySidebar =
    Boolean(bucketSlug) && !isJustCreatedConversation;

  const bucket = useMemo(() => {
    return resolveBucketKeyFromDisplaySlug(
      conversations,
      coworkers,
      bucketSlug,
    );
  }, [bucketSlug, conversations, coworkers]);

  const bucketData = useMemo(() => {
    if (!bucket) return null;
    const list = conversations.filter((c) => {
      const meta = (c.metadata as Record<string, unknown> | null) ?? null;
      return getBucketKeyFromMetadata(meta) === bucket;
    });
    const meta =
      list.length > 0
        ? ((list[0].metadata as Record<string, unknown> | null) ?? null)
        : null;
    const displayName =
      (meta?.model_name as string | undefined) ??
      (meta?.coworker_name as string | undefined) ??
      bucket ??
      "Chat";
    return { displayName, conversations: list };
  }, [bucket, conversations]);

  const showTwoColumn = Boolean(bucketSlug) && showSecondarySidebar;

  // Mobile: bucket routes show the conversation list; conversation URLs show chat (bookmarks, refresh, shared links).
  const mobileListOnly =
    showTwoColumn && Boolean(bucketSlug) && !conversationIdFromPath;
  const mobileChatOnly = Boolean(conversationIdFromPath) && !mobileListOnly;

  return (
    <div
      className={
        showTwoColumn
          ? "-mt-20 -mr-4 -mb-4 flex h-full min-h-0 w-full min-w-0 flex-1 flex-col gap-4 md:-mt-4 lg:flex-row lg:gap-0"
          : "flex h-full min-h-0 w-full flex-1 flex-col"
      }
    >
      {showTwoColumn && bucketSlug ? (
        <>
          {mobileListOnly ? (
            <div className="bg-background fixed inset-0 z-20 flex h-dvh w-full flex-col overflow-hidden lg:hidden">
              <ChatConversationsSidebar
                bucketSlug={bucketSlug}
                bucket={bucket ?? ""}
                displayName={bucketData?.displayName ?? bucketSlug ?? "Chat"}
                conversations={bucketData?.conversations ?? []}
              />
            </div>
          ) : null}
          <div className="lg:border-border hidden lg:flex lg:max-h-full lg:min-h-0 lg:w-72 lg:shrink-0 lg:flex-col lg:overflow-hidden lg:rounded-none lg:border-t-0 lg:border-r lg:border-b-0 lg:border-l-0">
            <ChatConversationsSidebar
              bucketSlug={bucketSlug}
              bucket={bucket ?? ""}
              displayName={bucketData?.displayName ?? bucketSlug ?? "Chat"}
              conversations={bucketData?.conversations ?? []}
            />
          </div>
        </>
      ) : null}

      <div
        className={
          mobileChatOnly
            ? "bg-background fixed inset-0 z-10 flex h-dvh w-full flex-col px-0 md:px-2 lg:static lg:z-auto lg:mx-auto lg:h-full lg:max-w-4xl lg:min-w-0 lg:flex-1 lg:pt-0"
            : mobileListOnly
              ? "hidden lg:mx-auto lg:flex lg:h-full lg:max-w-4xl lg:min-w-0 lg:flex-1 lg:flex-col lg:pt-0 lg:pl-4"
              : showTwoColumn
                ? "mx-auto flex h-full w-full max-w-4xl min-w-0 flex-1 flex-col pt-20 md:pt-4 md:pl-4 lg:min-w-0 lg:pt-0"
                : "mx-auto flex h-full w-full max-w-4xl flex-1 flex-col px-0 md:px-2"
        }
      >
        <div
          className={
            mobileChatOnly && conversationIdFromPath
              ? "flex min-h-0 flex-1 flex-col overflow-visible lg:min-h-0"
              : "flex h-full flex-col"
          }
        >
          <ChatInterface
            mobileKeyboardOptimized={mobileKeyboardOptimized}
            organizationSlug={organizationSlug}
            userImageUrl={userImageUrl}
            userName={userName}
            initialDesignMdAttachment={initialDesignMdAttachment}
          />
        </div>
      </div>
    </div>
  );
}

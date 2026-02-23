"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";

import { ChatConversationsSidebar } from "@/app/chat/components/chat-conversations-sidebar";
import ChatInterface from "@/app/chat/components/chat-interface";
import {
  bucketKeyFromDisplaySlug,
  bucketKeyToSlug,
  getBucketKeyFromMetadata,
  slugify,
  slugToBucketKey,
} from "@/app/chat/utils/bucket-slug";
import { useConversationsContext } from "@/contexts/conversations-context";
import { useCoworkersContext } from "@/contexts/coworkers-context";

function getBucketSlugFromPathname(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "chat" || segments.length < 2) return null;
  return segments[1] ?? null;
}

const SHOW_SECONDARY_SIDEBAR_KEY = "chat-show-secondary-sidebar";

function getShowSecondarySidebar(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(SHOW_SECONDARY_SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

interface ChatLayoutClientProps {
  organizationSlug: string | null;
  userImageUrl: string;
  userName: string | undefined;
}

export function ChatLayoutClient({
  organizationSlug,
  userImageUrl,
  userName,
}: ChatLayoutClientProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { conversations } = useConversationsContext();
  const { coworkers } = useCoworkersContext();

  const bucketSlug = useMemo(
    () => getBucketSlugFromPathname(pathname ?? ""),
    [pathname],
  );

  const showSecondarySidebar = getShowSecondarySidebar();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const bucket = params.get("bucket");
    const conversationId = params.get("conversationId");
    if (bucket && conversationId) {
      const slug = bucketKeyToSlug(bucket);
      if (slug && slug !== "other") {
        router.replace(`/chat/${slug}/conversation/${conversationId}`, {
          scroll: false,
        });
      }
    } else if (bucket) {
      const slug = bucketKeyToSlug(bucket);
      if (slug && slug !== "other") {
        router.replace(`/chat/${slug}`, { scroll: false });
      }
    }
  }, [router]);

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

  return (
    <div
      className={
        showTwoColumn
          ? "-mt-20 -mr-4 -mb-4 flex h-full w-full min-w-0 flex-1 flex-col gap-4 md:-mt-4 lg:flex-row lg:gap-0"
          : "flex h-full w-full flex-1 flex-col"
      }
    >
      {showTwoColumn && bucketSlug ? (
        <div className="border-border max-h-[45vh] w-full shrink-0 overflow-hidden rounded-lg border lg:h-full lg:max-h-none lg:min-h-[calc(100svh-64px)] lg:w-72 lg:rounded-none lg:border-t-0 lg:border-r lg:border-b-0 lg:border-l-0">
          <ChatConversationsSidebar
            bucketSlug={bucketSlug}
            bucket={bucket ?? ""}
            displayName={bucketData?.displayName ?? bucketSlug ?? "Chat"}
            conversations={bucketData?.conversations ?? []}
          />
        </div>
      ) : null}
      <div
        className={
          showTwoColumn
            ? "mx-auto flex h-full w-full max-w-4xl min-w-0 flex-1 flex-col px-2 pt-20 pr-4 pb-4 pl-4 md:pt-4 lg:min-w-0"
            : "mx-auto flex h-full w-full max-w-4xl flex-1 flex-col px-2"
        }
      >
        <ChatInterface
          organizationSlug={organizationSlug}
          userImageUrl={userImageUrl}
          userName={userName}
        />
      </div>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { bucketKeyToSlug } from "@/app/chat/utils/bucket-slug";

import ChatInterface from "./chat-interface";

interface ChatPageClientProps {
  organizationSlug: string | null;
  userImageUrl: string;
  userName: string | undefined;
}

export function ChatPageClient({
  organizationSlug,
  userImageUrl,
  userName,
}: ChatPageClientProps) {
  const router = useRouter();

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

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-1 flex-col px-2">
      <ChatInterface
        organizationSlug={organizationSlug}
        userImageUrl={userImageUrl}
        userName={userName}
      />
    </div>
  );
}

"use client";

import type { ChatFeed } from "@sokosumi/core-client";
import { Inbox, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  ChatEmptyState,
  ChatUnreadViewHeader,
} from "@/app/chat/components/chat-unread-view-header";
import { ThreadListLoadMore } from "@/components/chat/thread-list-load-more";
import { Button } from "@/components/ui/button";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";

import { FeedItemRow } from "./feed-item-row";
import { useChatFeed } from "./use-chat-feed";

interface FeedViewProps {
  /** Core's first page at request time, or null when that read failed. */
  initialPage: ChatFeed | null;
  currentUserId: string;
  organizationId: string | null;
}

/** The Feed page: messages that need the reader, newest first, read only. */
export function FeedView({
  initialPage,
  currentUserId,
  organizationId,
}: FeedViewProps) {
  const t = useTranslations("App.Channels.Feed");
  const query = useChatFeed({ initialPage, currentUserId, organizationId });
  const items = (query.data?.pages ?? []).flatMap((page) => page.items);

  return (
    <div className="flex w-full flex-col gap-4 pb-4">
      <div className="flex flex-col gap-1">
        <ChatUnreadViewHeader title={t("title")} />
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </div>
      <div className={cn(HOLDER_CLASS, "flex flex-col gap-2")}>
        <div className={cn(HOLDER_ITEM_CLASS, "flex flex-col p-2")}>
          {query.isError && items.length === 0 ? (
            <div className="flex flex-col items-start gap-2 px-2 py-2">
              <p className="text-muted-foreground text-sm">{t("loadError")}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void query.refetch()}
              >
                {t("retry")}
              </Button>
            </div>
          ) : query.isPending ? (
            <Loader2
              className="text-muted-foreground size-5 animate-spin motion-reduce:animate-none"
              aria-label={t("listLabel")}
            />
          ) : items.length === 0 ? (
            <ChatEmptyState
              icon={Inbox}
              title={t("empty")}
              description={t("emptyDescription")}
              testId="feed-empty"
            />
          ) : (
            <>
              <ul
                aria-label={t("listLabel")}
                className="flex flex-col gap-3"
                data-testid="feed"
              >
                {items.map((item) => (
                  <FeedItemRow
                    key={`${item.lane}:${item.message.id}`}
                    item={item}
                    currentUserId={currentUserId}
                  />
                ))}
              </ul>
              {query.hasNextPage ? (
                <ThreadListLoadMore
                  boundaryKey={items.at(-1)?.message.id ?? ""}
                  status={
                    query.isFetchingNextPage
                      ? "loading"
                      : query.isFetchNextPageError
                        ? "failed"
                        : "idle"
                  }
                  onLoad={() => void query.fetchNextPage()}
                  labels={{
                    load: t("loadMore"),
                    error: t("loadError"),
                    retry: t("retry"),
                  }}
                />
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

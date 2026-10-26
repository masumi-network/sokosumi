"use client";

import type { SocialPost } from "@sokosumi/core-client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useFormatter, useTimeZone, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { useDebounce } from "use-debounce";
import { TimezoneLabel } from "@/components/timezone-label";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DEFAULT_TIME_ZONE } from "@/i18n/time-zone";
import { useSession } from "@/lib/auth/auth.client";
import { loadSocialPostQuoteCandidates } from "./actions";
import { SocialPostPreview } from "./social-post-preview";
import { SocialPostStatusBadge } from "./social-post-status-badge";

export function SocialPostQuotePicker({
  projectId,
  excludePostId,
  onSelect,
  onOpenChange,
  onCloseAutoFocus,
}: {
  projectId: string;
  excludePostId?: string;
  onSelect: (post: SocialPost) => void;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const t = useTranslations("App.Projects.SocialPosts");
  const formatter = useFormatter();
  const timeZone = useTimeZone() ?? DEFAULT_TIME_ZONE;
  const searchId = useId();
  const [search, setSearch] = useState("");
  const [query] = useDebounce(search.trim(), 300);
  const { data: session } = useSession();
  const candidates = useInfiniteQuery({
    queryKey: [
      "social-post-quote-candidates",
      session?.user?.id,
      session?.session.activeOrganizationId ?? null,
      projectId,
      excludePostId,
      query,
    ],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      loadSocialPostQuoteCandidates({
        projectId,
        excludePostId,
        search: query,
        cursor: pageParam || undefined,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });
  const posts = candidates.data?.pages.flatMap((page) => page.posts) ?? [];

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85dvh] overflow-y-auto overscroll-contain"
        data-task-form-portal=""
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{t("quote.choose")}</DialogTitle>
          <DialogDescription>{t("quote.pickerDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label htmlFor={searchId} className="text-sm font-medium">
            {t("quote.search")}
          </label>
          <Input
            id={searchId}
            type="search"
            name="quote-search"
            maxLength={500}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div role="status" className="text-muted-foreground text-sm">
          {candidates.isPending
            ? t("loading")
            : !candidates.isError && posts.length === 0
              ? t("quote.empty")
              : null}
        </div>
        {candidates.isError ? (
          <div className="space-y-2">
            <p role="alert" className="text-destructive text-sm">
              {t("quote.loadFailed")}
            </p>
            <Button
              type="button"
              variant="outline"
              loading={candidates.isFetching}
              onClick={() => void candidates.refetch()}
            >
              {t("tryAgain")}
            </Button>
          </div>
        ) : null}
        <ul className="space-y-4">
          {posts.map((post) => (
            <li key={post.id} className="space-y-2">
              <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                <SocialPostStatusBadge
                  status={post.status}
                  label={t(`status.${post.status}`)}
                />
                {(post.publishedAt ?? post.scheduledAt) ? (
                  <span>
                    {formatter.dateTime(
                      (post.publishedAt ?? post.scheduledAt)!,
                      "dateTimeWithYear",
                      { timeZone },
                    )}{" "}
                    ·{" "}
                    <TimezoneLabel
                      timeZone={timeZone}
                      at={(post.publishedAt ?? post.scheduledAt)!}
                    />
                  </span>
                ) : null}
              </div>
              <SocialPostPreview
                provider="x"
                account={
                  post.socialConnection
                    ? {
                        handle: post.socialConnection.externalHandle,
                        displayName: post.socialConnection.displayName,
                        avatarUrl: post.socialConnection.avatarUrl,
                      }
                    : null
                }
                text={post.text}
                media={post.media}
                timestamp={post.publishedAt ?? post.scheduledAt}
                compact
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => onSelect(post)}
              >
                {t("quote.select")}
              </Button>
            </li>
          ))}
        </ul>
        {candidates.hasNextPage ? (
          <Button
            type="button"
            variant="outline"
            loading={candidates.isFetchingNextPage}
            disabled={candidates.isFetchingNextPage}
            onClick={() => void candidates.fetchNextPage()}
          >
            {t("loadMore")}
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

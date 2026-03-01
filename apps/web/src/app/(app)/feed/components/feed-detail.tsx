"use client";

import { BlobStatus } from "@sokosumi/database";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { useFeedData } from "@/app/feed/components/feed-data-provider";
import { AgentIcon } from "@/components/agents/agent-icon";
import CopyMarkdown from "@/components/jobs/job-details/copy-markdown";
import DownloadButton from "@/components/jobs/job-details/download-button";
import Markdown from "@/components/markdown";
import { SourcesGrid } from "@/components/sources/sources-grid";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  extractFileLikeLinks,
  extractHttpLinks,
} from "@/lib/data/markdown/links";
import type { FeedItem } from "@/lib/services/feed.service";
import { formatTimeAgo } from "@/lib/utils/datetime";
import {
  getFirstMarkdownHeading,
  removeFirstMarkdownHeading,
  resolveTitle,
} from "@/lib/utils/feed-helpers";
import { getInitials } from "@/lib/utils/text";

interface FeedDetailProps {
  feedId: string;
  item?: FeedItem | null;
}

function getFileNameFromUrl(url: string): string | null {
  try {
    return new URL(url).pathname.split("/").pop() ?? null;
  } catch {
    return url.split("/").pop() ?? null;
  }
}

export function FeedDetail({ feedId, item: initialItem }: FeedDetailProps) {
  const t = useTranslations("App.Feed");
  const { getItemById } = useFeedData();
  const item = initialItem ?? getItemById(feedId);

  if (!item) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-3 px-2 py-2">
        <Link
          href="/feed"
          className="text-muted-foreground inline-flex items-center gap-1 text-sm"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {t("backToFeed")}
        </Link>
        <p className="text-muted-foreground text-sm">{t("missingResult")}</p>
      </div>
    );
  }
  const actorName =
    item.actor.name?.trim() ||
    (item.actor.kind === "agent" ? t("unknownAgent") : t("unknownCoworker"));
  const title =
    item.displayTitle ||
    resolveTitle(item, t("untitledJob"), t("untitledTask"));
  const firstHeading = getFirstMarkdownHeading(item.contentMarkdown);
  const contentMarkdown =
    firstHeading === title
      ? removeFirstMarkdownHeading(item.contentMarkdown)
      : item.contentMarkdown;
  const sourceFiles = contentMarkdown
    ? extractFileLikeLinks(contentMarkdown).map((url, fileIndex) => ({
        id: `${item.id}-file-${fileIndex}`,
        sourceUrl: url,
        fileUrl: url,
        name: getFileNameFromUrl(url),
        status: BlobStatus.READY,
      }))
    : [];
  const sourceLinks = contentMarkdown
    ? extractHttpLinks(contentMarkdown).map((url, linkIndex) => ({
        id: `${item.id}-link-${linkIndex}`,
        url,
      }))
    : [];
  const hasSources = sourceFiles.length > 0 || sourceLinks.length > 0;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-2">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/feed"
          className="text-muted-foreground inline-flex items-center gap-1 text-sm"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {t("backToFeed")}
        </Link>
        <Button asChild variant="outline" size="sm">
          <Link href={item.detailHref}>{t("openOriginal")}</Link>
        </Button>
      </div>

      <section className="space-y-2">
        <div className="flex min-w-0 items-center gap-2">
          {item.actor.kind === "agent" ? (
            <AgentIcon
              agent={{
                name: actorName,
                icon: item.actor.icon,
              }}
            />
          ) : (
            <Avatar className="size-5">
              {item.actor.image ? (
                <AvatarImage
                  src={item.actor.image}
                  alt={actorName}
                  className="object-cover"
                />
              ) : null}
              <AvatarFallback className="text-[10px]">
                {getInitials(actorName)}
              </AvatarFallback>
            </Avatar>
          )}
          <div className="min-w-0">
            <p className="text-foreground truncate text-sm font-medium">
              {actorName}
            </p>
            <p className="text-muted-foreground text-xs">
              {formatTimeAgo(item.activityAt)}
            </p>
          </div>
        </div>

        <h1 className="text-xl font-semibold">{title}</h1>
      </section>

      <section className="space-y-3">
        {contentMarkdown ? (
          <>
            <Markdown className="text-foreground/85">
              {contentMarkdown}
            </Markdown>
            <div className="flex items-center gap-1">
              <DownloadButton markdown={contentMarkdown} />
              <CopyMarkdown markdown={contentMarkdown} />
            </div>
            {hasSources ? (
              <div className="space-y-1.5">
                <Separator className="my-3" />
                {sourceFiles.length > 0 ? (
                  <SourcesGrid
                    title={t("sourcesFiles")}
                    blobs={sourceFiles}
                    className="mt-0"
                  />
                ) : null}
                {sourceLinks.length > 0 ? (
                  <SourcesGrid
                    title={t("sourcesLinks")}
                    links={sourceLinks}
                    className="mt-0"
                  />
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            {t("fallbackPreview")}
          </p>
        )}
      </section>
    </div>
  );
}

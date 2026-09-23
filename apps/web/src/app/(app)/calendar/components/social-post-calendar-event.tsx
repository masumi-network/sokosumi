"use client";

import { Folder, Paperclip, UserRound } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { SiX } from "react-icons/si";
import { SocialPostStatusBadge } from "@/app/projects/components/social-posts/social-post-status-badge";
import type { SocialPostCalendarItem } from "@/lib/clients/generated/core";

export function SocialPostCalendarEvent({
  item,
  timeZone,
}: {
  item: SocialPostCalendarItem;
  timeZone: string;
}) {
  const t = useTranslations("App.Calendar.socialPost");
  const statuses = useTranslations("App.Projects.SocialPosts.status");
  const formatter = useFormatter();
  return (
    <Link
      href={`/projects/${item.sourceProjectId}/social?postId=${item.postId}#social-post-${item.postId}`}
      className="bg-background text-foreground hover:bg-muted focus-visible:ring-ring-halo flex min-w-0 flex-col gap-2 rounded-md border border-border p-2 text-xs focus-visible:outline-none focus-visible:ring-2"
      data-testid="calendar-social-post"
    >
      <span className="flex items-center justify-between gap-2">
        <SiX role="img" aria-label="X" className="size-3 shrink-0" />
        <span className="text-muted-foreground whitespace-nowrap tabular-nums">
          {formatter.dateTime(item.scheduledAt, "time", { timeZone })}
        </span>
      </span>
      <span className="line-clamp-2 break-words font-medium">
        {item.text || t("mediaOnly")}
      </span>
      {item.externalHandle ? (
        <span className="text-muted-foreground truncate">
          @{item.externalHandle}
        </span>
      ) : null}
      <span
        className="text-muted-foreground flex min-w-0 items-center gap-1"
        title={t("project", { name: item.projectName })}
      >
        <Folder aria-hidden className="size-3 shrink-0" />
        <span className="sr-only">{t("projectLabel")}</span>
        <span className="truncate">{item.projectName}</span>
      </span>
      <span
        className="text-muted-foreground flex min-w-0 items-center gap-1"
        title={t("scheduledBy", {
          name: item.scheduledByName ?? t("unknownScheduler"),
        })}
      >
        <UserRound aria-hidden className="size-3 shrink-0" />
        <span className="truncate">
          {t("scheduledBy", {
            name: item.scheduledByName ?? t("unknownScheduler"),
          })}
        </span>
      </span>
      <span className="flex flex-wrap items-center justify-between gap-1">
        <SocialPostStatusBadge
          status={item.status}
          label={statuses(item.status)}
        />
        {item.attachmentCount > 0 ? (
          <span
            className="text-muted-foreground flex items-center gap-1"
            title={t("attachments", { count: item.attachmentCount })}
          >
            <Paperclip aria-hidden className="size-3 shrink-0" />
            <span aria-hidden className="tabular-nums">
              {item.attachmentCount}
            </span>
            <span className="sr-only">
              {t("attachments", { count: item.attachmentCount })}
            </span>
          </span>
        ) : null}
      </span>
    </Link>
  );
}

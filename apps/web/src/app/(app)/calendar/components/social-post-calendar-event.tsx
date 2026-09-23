"use client";

import { MessageSquare } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
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
      className="bg-background text-foreground hover:bg-muted focus-visible:ring-ring-halo flex min-w-0 flex-col gap-1 rounded border border-border px-1.5 py-1 text-xs focus-visible:outline-none focus-visible:ring-2"
      data-testid="calendar-social-post"
    >
      <span className="flex items-center gap-1 text-muted-foreground">
        <MessageSquare aria-hidden className="size-3 shrink-0" />
        <span>{t("label")}</span>
        <span className="tabular-nums">
          {formatter.dateTime(item.scheduledAt, "time", { timeZone })}
        </span>
      </span>
      <span className="line-clamp-2">{item.text || t("mediaOnly")}</span>
      {item.externalHandle ? (
        <span className="truncate">@{item.externalHandle}</span>
      ) : null}
      <SocialPostStatusBadge
        status={item.status}
        label={statuses(item.status)}
      />
    </Link>
  );
}

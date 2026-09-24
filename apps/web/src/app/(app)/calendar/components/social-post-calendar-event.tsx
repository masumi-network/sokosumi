"use client";

import { Paperclip } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { SiX } from "react-icons/si";
import { SocialPostStatusBadge } from "@/app/projects/components/social-posts/social-post-status-badge";
import { UserProfileAvatar } from "@/components/user/user-profile-avatar";
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
  const scheduler = t("scheduledBy", {
    name: item.scheduledByName ?? t("unknownScheduler"),
  });
  const account = item.externalHandle ? `X · @${item.externalHandle}` : "X";
  return (
    <Link
      href={`/projects/${item.sourceProjectId}/social?postId=${item.postId}#social-post-${item.postId}`}
      className="bg-background text-foreground hover:bg-muted border border-border flex w-full min-w-0 cursor-pointer select-none flex-col items-start gap-0.5 overflow-hidden rounded px-1.5 py-1 text-left text-xs font-medium motion-safe:transition-colors motion-safe:duration-150 motion-safe:ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-halo"
      data-testid="calendar-social-post"
    >
      <span className="flex w-full min-w-0 items-center gap-1">
        <span
          className="flex size-4 shrink-0 items-center justify-center"
          title={account}
        >
          <SiX role="img" aria-label={account} className="size-3" />
        </span>
        <span className="text-muted-foreground shrink-0 tabular-nums">
          {formatter.dateTime(item.scheduledAt, "time", { timeZone })}
        </span>
        <span
          className="text-muted-foreground min-w-0 truncate"
          title={t("project", { name: item.projectName })}
        >
          <span className="sr-only">{t("projectLabel")}</span>
          {item.projectName}
        </span>
      </span>
      <span className="line-clamp-2 w-full min-w-0 break-words">
        {item.text || t("mediaOnly")}
      </span>
      <span className="flex w-full min-w-0 items-center gap-1">
        <span aria-hidden className="flex shrink-0" title={scheduler}>
          <UserProfileAvatar
            name={item.scheduledByName ?? ""}
            image={item.scheduledByImage}
          />
        </span>
        <span className="sr-only">{scheduler}</span>
        <SocialPostStatusBadge
          status={item.status}
          label={statuses(item.status)}
          showLabel={false}
        />
        {item.attachmentCount > 0 ? (
          <span
            className="text-muted-foreground ml-auto flex shrink-0 items-center gap-1"
            title={t("attachments", { count: item.attachmentCount })}
          >
            <Paperclip aria-hidden className="size-3" />
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

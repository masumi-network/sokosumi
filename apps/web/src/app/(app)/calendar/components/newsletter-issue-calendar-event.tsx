"use client";

import type { NewsletterIssueCalendarItem } from "@sokosumi/core-client";
import { Mail } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";

export function NewsletterIssueCalendarEvent({
  item,
  timeZone,
}: {
  item: NewsletterIssueCalendarItem;
  timeZone: string;
}) {
  const t = useTranslations("App.Calendar.newsletter");
  const status = useTranslations("App.Projects.Newsletter.Issues.statuses");
  const format = useFormatter();
  return (
    <Link
      href={`/projects/${item.sourceProjectId}/newsletter/issues/${item.issueId}`}
      className="bg-background text-foreground hover:bg-muted border-border focus-visible:ring-ring-halo block w-full min-w-0 rounded border p-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
      data-testid="calendar-newsletter-issue"
    >
      <span className="flex flex-wrap items-center gap-1 text-xs">
        <Mail className="size-3.5 shrink-0" />
        <span>{t("label")}</span>
        <span className="text-muted-foreground tabular-nums">
          {format.dateTime(item.scheduledAt, "time", { timeZone })}
        </span>
      </span>
      <span className="block truncate font-medium" title={item.subject}>
        {item.subject}
      </span>
      <span className="text-muted-foreground text-xs">
        {status(item.status)}
      </span>
    </Link>
  );
}

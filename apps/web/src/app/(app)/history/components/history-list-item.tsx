"use client";

import Link from "next/link";
import { useFormatter } from "next-intl";
import {
  HistoryMetaTime,
  HistoryOwnerAvatar,
} from "@/app/history/components/history-meta";
import { HistoryTypeIcon } from "@/app/history/components/history-type-icon";
import { getHistoryItemHref } from "@/app/history/utils/history-item-href";
import { getHistoryRowSubtitle } from "@/app/history/utils/history-row-subtitle";
import type { TransactionHistoryItem } from "@/lib/services/history.service";
import { cn } from "@/lib/utils";
import { formatCreditsForDisplay } from "@/lib/utils/credits";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";

export interface HistoryListItemLabels {
  credit: string;
  credits: string;
  noDescription: string;
  consumed: string;
  kind: {
    job: string;
    image: string;
    task: string;
    coworker: string;
    sokoBot: string;
    unattributed: string;
  };
}

interface HistoryListItemProps {
  item: TransactionHistoryItem;
  labels: HistoryListItemLabels;
  activeOrganizationId: string | null;
}

export function HistoryListItem({
  item,
  labels,
  activeOrganizationId,
}: HistoryListItemProps) {
  const { formatDateWithYear } = useLocalizedDateTime();
  const formatter = useFormatter();
  const description = getHistoryRowSubtitle(item, labels);
  const credits = formatHistoryCredits(item.credits, labels, formatter.number);
  const href = getHistoryItemHref(item);
  const showOwner = activeOrganizationId !== null;
  const rowClassName = cn(
    "group grid grid-cols-[auto_minmax(0,1fr)] bg-background gap-x-3 gap-y-2 rounded-lg border border-border px-4 py-3 transition-colors",
    showOwner
      ? "sm:grid-cols-[100px_minmax(0,1fr)_32px_110px_80px] sm:items-center sm:gap-4"
      : "sm:grid-cols-[100px_minmax(0,1fr)_110px_80px] sm:items-center sm:gap-4",
    href ? "hover:bg-card-background-hover press content-in" : "cursor-default",
  );
  const content = (
    <HistoryListItemContent
      credits={credits}
      description={description}
      formatShortDate={formatDateWithYear}
      item={item}
      labels={labels}
      activeOrganizationId={activeOrganizationId}
    />
  );

  // Coworker seats, Soko Bot usage and unattributed spends have no page behind
  // them, so those rows are text rather than a link to nowhere.
  if (!href) {
    return <div className={rowClassName}>{content}</div>;
  }

  return (
    <Link href={href} className={rowClassName}>
      {content}
    </Link>
  );
}

function HistoryListItemContent({
  credits,
  description,
  formatShortDate,
  item,
  labels,
  activeOrganizationId,
}: {
  credits: string;
  description: string;
  formatShortDate: (date: string | Date) => string;
  item: TransactionHistoryItem;
  labels: HistoryListItemLabels;
  activeOrganizationId: string | null;
}) {
  const showOwner = activeOrganizationId !== null;
  return (
    <>
      <HistoryTypeColumn item={item} labels={labels} />

      <div className="min-w-0">
        <span className="text-foreground line-clamp-1 text-sm font-medium">
          {item.title}
        </span>
        <p className="text-muted-foreground mt-1 line-clamp-1 text-xs break-all">
          {description}
        </p>
      </div>

      <div className="text-muted-foreground col-span-2 flex flex-wrap items-center gap-3 text-xs sm:contents justify-between sm:justify-start">
        {showOwner && (
          <div className="flex items-center sm:col-start-3 sm:row-start-1">
            <HistoryOwnerAvatar owner={item.owner} />
          </div>
        )}
        <HistoryMetaTime
          consumedAt={item.consumedAt}
          formatShortDate={formatShortDate}
          consumedLabel={labels.consumed}
          className={cn(
            showOwner
              ? "sm:col-start-4 sm:row-start-1"
              : "sm:col-start-3 sm:row-start-1",
          )}
        />
        <span
          className={cn(
            "text-muted-foreground tabular-nums sm:text-right",
            showOwner
              ? "sm:col-start-5 sm:row-start-1"
              : "sm:col-start-4 sm:row-start-1",
          )}
        >
          {credits}
        </span>
      </div>
    </>
  );
}

export function HistoryTypeColumn({
  item,
  labels,
}: {
  item: TransactionHistoryItem;
  labels: Pick<HistoryListItemLabels, "kind">;
}) {
  return (
    <div className="flex w-9 shrink-0 items-center gap-1.5 sm:w-30">
      <span
        className="text-muted-foreground flex size-9 items-center justify-center rounded-full"
        aria-hidden
      >
        <HistoryTypeIcon item={item} />
      </span>
      <span className="text-muted-foreground w-full rounded-full px-1.5 py-0.5 text-[0.625rem] font-medium hidden sm:block">
        {labels.kind[item.kind]}
      </span>
    </div>
  );
}

function formatHistoryCredits(
  credits: number,
  labels: Pick<HistoryListItemLabels, "credit" | "credits">,
  formatNumber: (value: number) => string,
): string {
  const formattedCredits = formatCreditsForDisplay(credits);
  const unit = formattedCredits === 1 ? labels.credit : labels.credits;

  return `${formatNumber(formattedCredits)} ${unit}`;
}

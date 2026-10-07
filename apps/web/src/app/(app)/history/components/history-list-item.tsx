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
    topUp: string;
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
  const credits = formatHistoryCredits(item, labels, formatter.number);
  const href = getHistoryItemHref(item);
  const showOwner = activeOrganizationId !== null;
  // Main's grid minus the status column. The amount column takes 130px rather
  // than main's 80px because a ledger amount runs to five or six digits plus
  // decimals ("14,568.25 credits"); narrower, it wraps onto a second line and
  // gives every row a ragged right edge.
  const rowClassName = cn(
    "group grid grid-cols-[auto_minmax(0,1fr)] bg-background gap-x-3 gap-y-2 rounded-lg border border-border px-4 py-3 transition-colors",
    showOwner
      ? "sm:grid-cols-[100px_minmax(0,1fr)_32px_110px_130px] sm:items-center sm:gap-4"
      : "sm:grid-cols-[100px_minmax(0,1fr)_110px_130px] sm:items-center sm:gap-4",
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

  // Coworker seats, top ups and unattributed spends have no page behind
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
            "text-muted-foreground tabular-nums whitespace-nowrap sm:text-right",
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
      {/* `truncate`: the column is 120px wide and the chip label is now a
          source name, not one of main's three short words. Without it a long
          label ran under the title and broke the row's left alignment. */}
      <span className="text-muted-foreground w-full truncate rounded-full px-1.5 py-0.5 text-2xs font-medium hidden sm:block">
        {labels.kind[item.kind]}
      </span>
    </div>
  );
}

/**
 * Amounts keep two decimals, so a Soko Bot turn under one credit isn't shown
 * as 0, and totals match the assistant page. A top up carries a leading `+`, so
 * the two directions are told apart by the sign and the source chip rather than
 * by a colour: the app has no green/red convention for a credit amount, and
 * inventing one here would be a new accent role on a surface that has none.
 */
function formatHistoryCredits(
  item: TransactionHistoryItem,
  labels: Pick<HistoryListItemLabels, "credit" | "credits">,
  formatNumber: (
    value: number,
    options: { maximumFractionDigits: number },
  ) => string,
): string {
  const credits = Math.trunc(item.credits * 100) / 100;
  const unit = credits === 1 ? labels.credit : labels.credits;
  const amount = `${formatNumber(credits, { maximumFractionDigits: 2 })} ${unit}`;

  return item.kind === "topUp" ? `+${amount}` : amount;
}

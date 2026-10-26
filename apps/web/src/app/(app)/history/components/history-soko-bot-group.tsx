"use client";

import { ChevronRight } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import {
  formatCreditAmount,
  HistoryListItem,
  type HistoryListItemLabels,
  HistoryTypeColumn,
} from "@/app/history/components/history-list-item";
import {
  HistoryMetaTime,
  HistoryOwnerAvatar,
} from "@/app/history/components/history-meta";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { TransactionHistoryItem } from "@/lib/services/history.service";
import { cn } from "@/lib/utils";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";

type SokoBotItem = Extract<TransactionHistoryItem, { kind: "sokoBot" }>;

/**
 * One assistant's day of turns as a single row: how many, what they cost in
 * total, and the turns themselves one click away. Same grid as a plain row,
 * so the columns line up with the Tasks and Jobs around it.
 */
export function HistorySokoBotGroup({
  items,
  credits,
  labels,
  activeOrganizationId,
}: {
  items: SokoBotItem[];
  credits: number;
  labels: HistoryListItemLabels;
  activeOrganizationId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const t = useTranslations("App.TransactionHistory.Row");
  const formatter = useFormatter();
  const { formatDateWithYear } = useLocalizedDateTime();
  const [newest] = items;
  const showOwner = activeOrganizationId !== null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className={cn(
          "group bg-background border-border hover:bg-card-background-hover press grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-lg border px-4 py-3 text-left transition-colors",
          showOwner
            ? "sm:grid-cols-[100px_minmax(0,1fr)_32px_110px_130px] sm:items-center sm:gap-4"
            : "sm:grid-cols-[100px_minmax(0,1fr)_110px_130px] sm:items-center sm:gap-4",
        )}
      >
        <HistoryTypeColumn item={newest} labels={labels} />
        <div className="min-w-0">
          <span className="text-foreground flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <ChevronRight
              aria-hidden
              className="text-muted-foreground size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90"
            />
            <span className="line-clamp-1">{newest.title}</span>
          </span>
          <p className="text-muted-foreground mt-1 text-xs">
            {t("sokoBotTurns", { count: items.length })}
          </p>
        </div>
        <div className="text-muted-foreground col-span-2 flex flex-wrap items-center justify-between gap-3 text-xs sm:contents sm:justify-start">
          {showOwner ? (
            <div className="flex items-center sm:col-start-3 sm:row-start-1">
              <HistoryOwnerAvatar owner={newest.owner} />
            </div>
          ) : null}
          <HistoryMetaTime
            consumedAt={newest.consumedAt}
            formatShortDate={formatDateWithYear}
            consumedLabel={labels.consumed}
            className={
              showOwner
                ? "sm:col-start-4 sm:row-start-1"
                : "sm:col-start-3 sm:row-start-1"
            }
          />
          <span
            className={cn(
              "text-muted-foreground whitespace-nowrap tabular-nums sm:text-right",
              showOwner
                ? "sm:col-start-5 sm:row-start-1"
                : "sm:col-start-4 sm:row-start-1",
            )}
          >
            {formatCreditAmount(credits, labels, formatter.number)}
          </span>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul
          aria-label={t("sokoBotTurnsList", { name: newest.title })}
          className="border-border mt-2 ml-4 flex flex-col gap-2 border-l pl-3"
        >
          {items.map((item) => (
            <li key={item.id}>
              <HistoryListItem
                item={item}
                labels={labels}
                activeOrganizationId={activeOrganizationId}
              />
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

"use client";

import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { ArrowUpRight, SearchCheck } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { Fragment, type ReactNode } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";

/**
 * Below the sm breakpoint a table's rows stack as cards, so no column scrolls
 * out of view. The header row hides, and each cell names its column from its
 * data-label. The first cell (the row's name) and the last (its actions) take a
 * full line.
 */
export const SEO_STACKED_TABLE_CLASS = [
  "max-sm:[&_thead]:hidden",
  // Two columns of label-above-value, like the page cards' numbers.
  "max-sm:[&_tbody_tr]:grid max-sm:[&_tbody_tr]:grid-cols-2 max-sm:[&_tbody_tr]:gap-x-4 max-sm:[&_tbody_tr]:gap-y-2 max-sm:[&_tbody_tr]:px-3 max-sm:[&_tbody_tr]:py-3",
  "max-sm:[&_td]:min-w-0 max-sm:[&_td]:p-0 max-sm:[&_td]:text-left max-sm:[&_td]:whitespace-normal max-sm:[&_td:empty]:hidden",
  "max-sm:[&_td:first-child]:col-span-2 max-sm:[&_td:last-child:not(:empty)]:col-span-2",
  "max-sm:[&_td[data-label]]:before:block max-sm:[&_td[data-label]]:before:text-xs max-sm:[&_td[data-label]]:before:font-normal max-sm:[&_td[data-label]]:before:text-muted-foreground max-sm:[&_td[data-label]]:before:content-[attr(data-label)]",
].join(" ");

/** "US", "en" read as "United States · English" in the reader's language; an unknown code stays as written. */
export function seoMarketName(
  locale: string,
  countryCode: string,
  languageCode: string | null,
) {
  const name = (type: "region" | "language", code: string) => {
    try {
      return (
        new Intl.DisplayNames([locale], { type }).of(
          type === "region" ? code.toUpperCase() : code,
        ) ?? code
      );
    } catch {
      // A code Intl does not accept is shown as saved.
      return code;
    }
  };
  return [
    countryCode ? name("region", countryCode) : null,
    languageCode ? name("language", languageCode) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** A search box helps only in a list longer than about one screen. */
export const SEO_SEARCH_MIN_ROWS = 10;

/** One titled holder. Every SEO section uses it, so titles, help text and actions line up across tabs. */
export function SeoSection({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className={cn(HOLDER_CLASS, "min-w-0 space-y-2")}>
      <div className="flex flex-wrap items-start justify-between gap-2 px-2 pt-1">
        {/* Below 14rem beside the actions, the title and its text take their own row. */}
        <div className="min-w-0 flex-1 basis-56 space-y-0.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description ? (
            <p className="text-muted-foreground text-sm">{description}</p>
          ) : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function SeoEmpty({
  title,
  body,
  description,
  children,
}: {
  title?: string;
  body?: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn(HOLDER_ITEM_CLASS, "px-4 py-8")}>
      <EmptyState
        icon={SearchCheck}
        title={title}
        description={body ?? description ?? ""}
        action={children}
      />
    </div>
  );
}

/** An address may wrap after "/" or "."; it breaks mid-word only when one part is wider than the line. */
function seoUrlBreaks(url: string) {
  const parts: string[] = [];
  let current = "";
  const chars = [...url];
  for (const [index, char] of chars.entries()) {
    current += char;
    // No break inside "//".
    if (char === "." || (char === "/" && chars[index + 1] !== "/")) {
      parts.push(current);
      current = "";
    }
  }
  if (current) parts.push(current);
  let offset = 0;
  return parts.map((part) => {
    const start = offset;
    offset += part.length;
    return (
      <Fragment key={start}>
        {start ? <wbr /> : null}
        {part}
      </Fragment>
    );
  });
}

export function SeoPageLink({
  url,
  label,
}: {
  url: string;
  label?: string | null;
}) {
  return (
    <Link
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      // The break points split the text; the name stays the whole address.
      aria-label={label || url}
      className="inline-flex min-w-0 items-start gap-1 text-sm underline-offset-4 hover:underline"
    >
      <bdi className="[overflow-wrap:anywhere]">
        {label || seoUrlBreaks(url)}
      </bdi>
      <ArrowUpRight className="mt-0.5 size-3 shrink-0" aria-hidden />
    </Link>
  );
}

export function SeoDate({
  value,
  timeZone,
}: {
  value: string | Date | null;
  timeZone?: string;
}) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  if (!value) return <span>{t("none")}</span>;
  const date = value instanceof Date ? value : new Date(value);
  return (
    <time dateTime={date.toISOString()}>
      {format.dateTime(
        date,
        "dateTimeMedium",
        timeZone ? { timeZone } : undefined,
      )}
    </time>
  );
}

/** A reporting period of calendar days, shown as the provider's dates without a time zone shift. */
export function SeoPeriod({ from, to }: { from: string; to: string }) {
  const format = useFormatter();
  const day = (value: string) => new Date(`${value}T12:00:00Z`);
  // The locale picks the range form and its separator.
  return (
    <span>
      {format.dateTimeRange(day(from), day(to), {
        dateStyle: "medium",
        timeZone: "UTC",
      })}
    </span>
  );
}

export function SeoSource({
  observationId,
  workspace,
}: {
  observationId: string;
  workspace: ProjectSeoWorkspace;
}) {
  const t = useTranslations("App.Seo");
  const observation = workspace.observations.find(
    (item) => item.id === observationId,
  );
  return observation?.sourceTaskId ? (
    <Link
      href={`/tasks/${encodeURIComponent(observation.sourceTaskId)}`}
      className="text-xs underline underline-offset-4"
    >
      {t("openEvidence")}
    </Link>
  ) : null;
}

/** A quiet state label; the numbers and the next action stay the loudest marks. */
export function SeoState({ children }: { children: ReactNode }) {
  return (
    <Badge
      variant="outline"
      className="text-muted-foreground whitespace-normal font-normal"
    >
      {children}
    </Badge>
  );
}

"use client";

import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { Fragment, type ReactNode } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

/** The lists of the Rankings tab; a phone shows one at a time. */
export type SeoRankingsSection = "keywords" | "ideas" | "competitors";

/** Hides a section on a phone while another one is chosen; a wide screen shows every section. */
export function seoPhoneSectionClass(shown: boolean) {
  return shown ? undefined : "max-sm:hidden";
}

/** A search box helps only in a list longer than about one screen. */
export const SEO_SEARCH_MIN_ROWS = 10;
/** Rows a long list shows before its "Show more" button. */
export const SEO_LIST_PAGE_SIZE = 10;
/** The mark of the chosen one in a set of bordered toggle buttons. */
export const SEO_CHOSEN_CLASS = "bg-quinary border-foreground";
/**
 * A long label wraps inside a narrow column; the app's buttons do not by default.
 * 5px of padding and the 1px border keep one line at the 32px of a small button.
 */
export const SEO_WRAP_CLASS =
  "h-auto min-h-8 max-w-full py-[5px] text-start whitespace-normal";
/**
 * A small ghost button with an icon, in a column of text and bordered buttons:
 * its box hangs over the column by its padding and the icon's own margin on
 * each side, so the icon's drawing sits on the column edge and the label has
 * the full column width before it wraps.
 */
export const SEO_GHOST_EDGE_CLASS = "-mx-3 max-w-[calc(100%+1.5rem)]";

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

/**
 * A long list shows its first rows; this button under it shows the rest.
 * The button stays after the press, so the keyboard focus stays too.
 */
export function SeoShowMore({
  more,
  expanded,
  onToggle,
}: {
  /** The label that names how many rows wait, for example "Show 6 more keywords". */
  more: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("App.Seo");
  return (
    <div className="px-1 pt-1">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <ChevronDown
          className={cn(
            "transition-transform duration-150 ease-out motion-reduce:transition-none",
            expanded && "rotate-180",
          )}
        />
        {expanded ? t("overview.showLess") : more}
      </Button>
    </div>
  );
}

/** The Audit's own page has a row in the same list; only the other rows are competitors. */
export function seoHasCompetitor(data: {
  competitors: readonly { role: string }[];
}) {
  return data.competitors.some((row) => row.role === "competitor");
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
    // A section in a tab, not a whole page: no icon, and no taller than its two lines need.
    <div className={cn(HOLDER_ITEM_CLASS, "px-4")}>
      <EmptyState
        className="py-6"
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
  day,
}: {
  value: string | Date | null;
  timeZone?: string;
  /** The day alone. Two reads of one check differ by minutes; a line that dates the check must not. */
  day?: boolean;
}) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  if (!value) return <span>{t("none")}</span>;
  const date = value instanceof Date ? value : new Date(value);
  return (
    <time dateTime={date.toISOString()}>
      {day
        ? format.dateTime(date, {
            dateStyle: "medium",
            ...(timeZone ? { timeZone } : {}),
          })
        : format.dateTime(
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
      // A 40 px hit area on a phone; the negative margin keeps the line where it was.
      className="-my-3 inline-block py-3 text-xs underline underline-offset-4"
    >
      {t("timeline.viewResults")}
    </Link>
  ) : null;
}

/** The least width of a bar's fill, so a small count still shows a mark. */
const SEO_BAR_MIN_PERCENT = 4;

/** A count with a thin bar that sets it against the largest count of its list. */
export function SeoBarNumber({ value, max }: { value: number; max: number }) {
  const format = useFormatter();
  return (
    <span className="inline-flex flex-col items-end gap-1 max-sm:items-start">
      {format.number(value)}
      {max > 0 ? (
        <span
          aria-hidden
          className="bg-muted-foreground/25 block h-1 w-16 rounded-full"
        >
          <span
            className="bg-chart-5 block h-1 rounded-full"
            style={{
              width: `${value > 0 ? Math.max(SEO_BAR_MIN_PERCENT, Math.round((value / max) * 100)) : 0}%`,
            }}
          />
        </span>
      ) : null}
    </span>
  );
}

/** How bad an issue is. Critical and major are solid and minor is quiet, so the worst issue reads first. */
export function SeoSeverity({
  severity,
  children,
}: {
  severity: "critical" | "major" | "minor";
  children: ReactNode;
}) {
  return severity === "minor" ? (
    <SeoState>{children}</SeoState>
  ) : (
    <Badge variant="destructive">{children}</Badge>
  );
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

"use client";

import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { ArrowUpRight, ChevronDown, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { Fragment, type ReactNode } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
  HOLDER_ITEM_HOVER_CLASS,
} from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";

/** A column header names its column: it is quiet and in the weight of body text, so the rows lead. */
const SEO_QUIET_HEADERS_CLASS =
  "[&_th]:text-muted-foreground [&_th]:font-normal";

/**
 * Below the sm breakpoint a table's rows stack as cards, so no column scrolls
 * out of view. The header row hides, and each cell names its column from its
 * data-label. The first cell (the row's name) and the last (its actions) take a
 * full line.
 */
export const SEO_STACKED_TABLE_CLASS = [
  SEO_QUIET_HEADERS_CLASS,
  "max-sm:[&_thead]:hidden",
  // Two columns of label-above-value, like the page cards' numbers.
  "max-sm:[&_tbody_tr]:grid max-sm:[&_tbody_tr]:grid-cols-2 max-sm:[&_tbody_tr]:gap-x-4 max-sm:[&_tbody_tr]:gap-y-2 max-sm:[&_tbody_tr]:px-3 max-sm:[&_tbody_tr]:py-3",
  "max-sm:[&_td]:min-w-0 max-sm:[&_td]:p-0 max-sm:[&_td]:text-left max-sm:[&_td]:whitespace-normal max-sm:[&_td:empty]:hidden",
  "max-sm:[&_td:first-child]:col-span-2 max-sm:[&_td:last-child:not(:empty)]:col-span-2",
  "max-sm:[&_td[data-label]]:before:block max-sm:[&_td[data-label]]:before:text-xs max-sm:[&_td[data-label]]:before:font-normal max-sm:[&_td[data-label]]:before:text-muted-foreground max-sm:[&_td[data-label]]:before:content-[attr(data-label)]",
].join(" ");

/**
 * The stacked rows of a list with one button per row (keywords, ideas,
 * competitors). Below the sm breakpoint the name and the button share the first
 * line, and the values follow on one line that wraps, with a wide gap between
 * them: one line per value made a row 121 to 150 px high. No dot stands between
 * two values: when the second value went to the next line, the dot ended the
 * first line. A value that does not name
 * itself keeps its label before it. On a desktop the column headers are quiet.
 */
export const SEO_COMPACT_ROWS_CLASS = [
  "max-sm:[&_thead]:hidden",
  SEO_QUIET_HEADERS_CLASS,
  "max-sm:[&_tbody_tr]:flex max-sm:[&_tbody_tr]:flex-wrap max-sm:[&_tbody_tr]:items-start max-sm:[&_tbody_tr]:gap-x-2 max-sm:[&_tbody_tr]:gap-y-0.5 max-sm:[&_tbody_tr]:px-3 max-sm:[&_tbody_tr]:py-3",
  "max-sm:[&_td]:order-3 max-sm:[&_td]:min-w-0 max-sm:[&_td]:p-0 max-sm:[&_td]:text-left max-sm:[&_td]:whitespace-normal max-sm:[&_td:empty]:hidden",
  // A row of one cell (a chart under a keyword) keeps the full width.
  "max-sm:[&_td:only-child]:basis-full",
  "max-sm:[&_td:first-child:not(:last-child)]:order-1 max-sm:[&_td:first-child:not(:last-child)]:flex-1 max-sm:[&_td:first-child:not(:last-child)]:basis-0",
  // A name of one line stands at the middle of its button, not over an empty line.
  "max-sm:[&_td:first-child:not(:last-child)]:self-center",
  "max-sm:[&_td:last-child:not(:first-child)]:order-2 max-sm:[&_td:last-child:not(:first-child)]:shrink-0",
  // The button is 40 px high for a finger and the name line is 20 px: the button hangs 8 px over the line at
  // both sides, so no empty band stands between the name and its values (a row was 89 px, it is 73 px). At 8 px
  // the focus ring of the first row's button ends at the edge of the list, which clips.
  "max-sm:[&_td:last-child:not(:first-child)]:-my-2",
  // An empty item of full width ends the first line, so the values start a line of their own.
  // The item is a line too, so the row gap counts twice between the name and the values.
  "max-sm:[&_tbody_tr]:after:order-2 max-sm:[&_tbody_tr]:after:basis-full max-sm:[&_tbody_tr]:after:content-['']",
  // A value can be several paragraphs (a position per device): the label and the paragraphs are items of one line.
  "max-sm:[&_td:not(:first-child):not(:last-child):not(:empty)]:flex max-sm:[&_td:not(:first-child):not(:last-child):not(:empty)]:flex-wrap max-sm:[&_td:not(:first-child):not(:last-child):not(:empty)]:items-baseline max-sm:[&_td:not(:first-child):not(:last-child):not(:empty)]:gap-x-2",
  "max-sm:[&_td[data-label]]:before:text-muted-foreground max-sm:[&_td[data-label]]:before:content-[attr(data-label)]",
  // The space stands after a value that another value follows, so a value that starts a line has no indent.
  "max-sm:[&_td:not(:first-child):not(:empty):has(~td:not(:last-child):not(:empty))]:me-2",
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

/** The lists of the Rankings tab; one shows at a time. */
export type SeoRankingsSection = "keywords" | "ideas" | "competitors";

/** Hides a list of the Rankings tab while another one is chosen. */
export function seoSectionClass(shown: boolean) {
  return shown ? undefined : "hidden";
}

/** A search box helps only in a list longer than about one screen. */
export const SEO_SEARCH_MIN_ROWS = 20;
export { SEO_LIST_PAGE_SIZE, seoFoldCount } from "./seo-list-model";
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
  strong = false,
  titleHidden = false,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  /** The title is the result of the list, not its name: it reads as the loudest line. */
  strong?: boolean;
  /** The chosen tab already says this title: it stays for screen readers only. */
  titleHidden?: boolean;
}) {
  return (
    <section className={cn(HOLDER_CLASS, "min-w-0 space-y-2")}>
      <div className={cn("space-y-0.5 px-2 pt-1", titleHidden && "sr-only")}>
        {/* The button stands on the line of the title, on a phone too: a row of its own pushed the list down. */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          {/* Beside a button the title takes the room that is left and breaks inside it, so the button never drops to a
              row of its own. Its first line has the button's height, so the two share a middle line. */}
          <h2
            className={cn(
              "min-w-0 font-semibold",
              strong ? "text-base text-balance" : "text-sm",
              // The least width is the longest word: a narrower title would run under the buttons, so the buttons wrap then.
              actions &&
                (strong ? "min-w-min flex-1 py-1" : "min-w-min flex-1 py-1.5"),
            )}
          >
            {title}
          </h2>
          {actions}
        </div>
        {description ? (
          <p className="text-muted-foreground text-sm">{description}</p>
        ) : null}
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
        {expanded ? t("overview.showLess") : more}
        <ChevronDown
          className={cn(
            "transition-transform duration-150 ease-out motion-reduce:transition-none",
            expanded && "rotate-180",
          )}
        />
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

/** The site of the workspace. An Audit saves none, so its primary page stands for it. */
export function seoSiteUrl(workspace: ProjectSeoWorkspace) {
  return (
    workspace.websiteUrl ??
    workspace.pages.find((page) => page.relationship === "primary")?.url ??
    null
  );
}

/** The address after the site. Null for a page of another site, and for an address that does not parse. */
export function seoPagePath(url: string, site: string) {
  try {
    const page = new URL(url);
    return page.host === new URL(site).host
      ? `${page.pathname}${page.search}`
      : null;
  } catch {
    return null;
  }
}

/** A page of the Audit's site by its path, the home page by the given name; any other address in full. */
export function seoPageName(url: string, site: string | null, home: string) {
  const path = site ? seoPagePath(url, site) : null;
  return path === "/" ? home : (path ?? url);
}

export function SeoPageLink({
  url,
  label,
  site,
  clamp = false,
  quiet = false,
}: {
  url: string;
  label?: string | null;
  /** The site of the Audit. Rows of one site then show the path alone: the site would repeat on every row. */
  site?: string | null;
  /** On a phone the address keeps to one line and ends in dots: a path of three lines made a row 130 px high. The link opens the whole address. */
  clamp?: boolean;
  /** A detail under a name (the page of an open action, the page of a competitor): small and muted, as the page under a keyword. */
  quiet?: boolean;
}) {
  const t = useTranslations("App.Seo");
  const path = site ? seoPagePath(url, site) : null;
  return (
    <Link
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      // The break points split the text; the name stays the whole address.
      aria-label={label || url}
      title={path ? url : undefined}
      className={cn(
        "inline-flex max-w-full min-w-0 items-start gap-1 underline-offset-4 hover:underline",
        quiet ? "text-muted-foreground text-xs" : "text-sm",
      )}
    >
      <bdi
        className={cn(
          "min-w-0 [overflow-wrap:anywhere]",
          clamp && "max-sm:line-clamp-1 max-sm:break-all max-sm:[&>wbr]:hidden",
        )}
      >
        {label || (path === "/" ? t("pages.home") : seoUrlBreaks(path ?? url))}
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
  children,
  named = false,
}: {
  /** Null where the row comes from no check. */
  observationId: string | null;
  workspace: ProjectSeoWorkspace;
  /** The words of the link, for example the date of the check. Without a result to open they show as text. */
  children?: ReactNode;
  /** The words already say where the link leads, so no hidden words are added. */
  named?: boolean;
}) {
  const t = useTranslations("App.Seo");
  const observation = workspace.observations.find(
    (item) => item.id === observationId,
  );
  return observation?.sourceTaskId ? (
    <Link
      href={`/tasks/${encodeURIComponent(observation.sourceTaskId)}`}
      className={cn(
        "inline-block underline underline-offset-4",
        // Alone, the link has a 40 px hit area on a phone; the negative margin keeps the line where it was.
        // In a line of facts it grows only down: over it another link can stand.
        children ? "-mb-3 pb-3" : "-my-3 py-3 text-xs",
      )}
    >
      {children ? (
        <>
          {children}
          {/* A date alone does not say where the link leads. */}
          {named ? null : (
            <span className="sr-only">, {t("timeline.viewResults")}</span>
          )}
        </>
      ) : (
        t("timeline.viewResults")
      )}
    </Link>
  ) : (
    (children ?? null)
  );
}

/**
 * Facts of one list on one line that wraps, with a dot between them. The dot
 * stands in the space before the fact after it. A fact that starts a line has
 * that space outside the start edge of the line, where it is cut off: no line
 * ends or starts with a dot.
 */
export function SeoMetaLine({
  items,
  className,
}: {
  /** A name and its fact; an empty fact leaves the line. */
  items: [string, ReactNode][];
  className?: string;
}) {
  const shown = items.filter(
    ([, fact]) => fact !== null && fact !== undefined && fact !== false,
  );
  return shown.length ? (
    <p className={cn("text-muted-foreground", className)}>
      {/* The cut is 4 px before the text, so a link that starts a line has room for its focus ring. */}
      <span className="-mx-1 flex flex-wrap items-baseline gap-x-4 overflow-x-clip px-1">
        {shown.map(([name, fact], index) => (
          <span key={name} className="relative -ms-4 ps-4">
            {/* The first fact always starts a line. The dot is a mark for the eye, not a word to read out. */}
            {index ? (
              <span aria-hidden className="absolute start-0 w-4 text-center">
                ·
              </span>
            ) : null}
            {fact}
          </span>
        ))}
      </span>
    </p>
  ) : null;
}

/** The least width of a bar's fill, so a small count still shows a mark. */
const SEO_BAR_MIN_PERCENT = 4;

/**
 * A count with a thin bar that sets it against the largest count of its list.
 * Below the sm breakpoint the row has no column head: the unit names the count there, and the bar goes.
 */
export function SeoBarNumber({
  value,
  max,
  unit,
}: {
  value: number;
  max: number;
  unit: string;
}) {
  const format = useFormatter();
  return (
    <span className="inline-flex flex-col items-end gap-1 max-sm:flex-row max-sm:items-baseline">
      {format.number(value)}
      <span className="sm:hidden">{unit}</span>
      {max > 0 ? (
        <span
          aria-hidden
          className="bg-muted block h-1 w-16 rounded-full max-sm:hidden"
        >
          {/* Sand, as every count of searches: demand has one colour. Orange is for impact. It grows in with its row. */}
          <span
            className="bg-chart-4 bar-grow stagger-delay block h-1 rounded-full"
            style={{
              width: `${value > 0 ? Math.max(SEO_BAR_MIN_PERCENT, Math.round((value / max) * 100)) : 0}%`,
            }}
          />
        </span>
      ) : null}
    </span>
  );
}

/** A page of the Audit's site as text under a name: its path, or "Home page". The Actions tab holds the links. */
export function SeoPageText({
  url,
  workspace,
  skipPrimary = false,
  oneLine = false,
}: {
  url: string;
  workspace: ProjectSeoWorkspace;
  /** A list where most rows belong to the one primary page names only the other pages. */
  skipPrimary?: boolean;
  /** On a phone the path is one line, cut with dots. Only for a row that its name tells apart: the cut hides the end of the path. */
  oneLine?: boolean;
}) {
  const t = useTranslations("App.Seo");
  const primary = workspace.pages.filter(
    (page) => page.relationship === "primary",
  );
  if (skipPrimary && primary.length === 1 && primary[0].url === url) {
    return null;
  }
  return (
    <bdi
      className={cn(
        "text-muted-foreground block text-xs [overflow-wrap:anywhere]",
        oneLine && "max-sm:truncate",
      )}
    >
      {seoPageName(url, seoSiteUrl(workspace), t("pages.home"))}
    </bdi>
  );
}

/**
 * The button that adds a row to a list. It is quiet, so the filled button of a tab stays the next step; a phone
 * shows the plus alone. With its label it rests in the quiet colour, so the rows and the next step of the list
 * are the brighter parts; the pointer and the keyboard focus make it bright.
 */
export function SeoAddButton({
  label,
  lead = false,
  onClick,
}: {
  label: string;
  /** The list is empty: the button is its only action and stays bright. */
  lead?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={label}
      // The plus alone keeps the 40 px width of an icon button.
      className={cn(
        "max-sm:min-w-10",
        !lead && "sm:text-muted-foreground sm:focus-visible:text-foreground",
      )}
      onClick={onClick}
    >
      <Plus className="size-4" />
      <span className="max-sm:hidden">{label}</span>
    </Button>
  );
}

/** The title of an action and, where two fixes can share a title, the page it is for: one piece for an Agent row and a closed action card. */
export function SeoActionName({
  title,
  pageUrl,
  workspace,
  strong = false,
}: {
  title: string;
  /** Null where the page already shows beside the name. */
  pageUrl: string | null;
  workspace: ProjectSeoWorkspace;
  /** The title of a card; a row is one step lighter. */
  strong?: boolean;
}) {
  return (
    <span className="block min-w-0 sm:flex-1">
      <span
        className={cn(
          // Plain wrap: inside a heading the title would balance its lines and break at another word than in a row.
          "block text-sm text-wrap break-words",
          strong ? "font-semibold" : "font-medium",
        )}
      >
        {title}
      </span>
      {pageUrl && workspace.scope.pageIds.length > 1 ? (
        <SeoPageText url={pageUrl} workspace={workspace} />
      ) : null}
    </span>
  );
}

/**
 * Rows of one group as one list: the frame is the list's and a line divides the rows, so a row inside has no
 * frame of its own. Separate framed rows read as separate things.
 */
export const SEO_ROW_LIST_CLASS = cn(
  HOLDER_ITEM_CLASS,
  // The rows come in one by one when the list mounts.
  "stagger [--stagger-step:40ms]",
  "[&>li]:rounded-none [&>li]:border-0 [&>li+li]:border-t [&>li+li]:border-border [&>li:first-child]:rounded-t-lg [&>li:last-child]:rounded-b-lg",
  "[&>li>article]:rounded-none [&>li>article]:border-0 [&>li:first-child>article]:rounded-t-lg [&>li:last-child>article]:rounded-b-lg",
  "[&>li>button]:rounded-none [&>li>button]:border-0 [&>li:first-child>button]:rounded-t-lg [&>li:last-child>button]:rounded-b-lg",
  // The head of a card that opens: square too, round only at the list's own corners.
  "[&>li>article>h3>button]:rounded-none [&>li:first-child>article>h3>button]:rounded-t-lg [&>li:last-child>article>h3>button[aria-expanded=false]]:rounded-b-lg",
  // The rows touch, so the row with a focus ring or a mark stands over its neighbours.
  "[&>li:focus-within]:relative [&>li:focus-within]:z-10 [&>li:has(>[aria-current=true])]:relative [&>li:has(>[aria-current=true])]:z-10",
);

/** The line that opens a fold in place: its words and one arrow, the same on every tab (no native triangle). */
export function SeoFoldSummary({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <summary
      className={cn(
        "focus-visible:ring-ring flex cursor-pointer list-none items-center gap-1 rounded-sm focus-visible:ring-2 focus-visible:outline-none [&::-webkit-details-marker]:hidden",
        className,
      )}
    >
      {children}
      <ChevronDown
        aria-hidden
        className="size-4 shrink-0 transition-transform duration-150 ease-out motion-reduce:transition-none [details[open]>summary>&]:rotate-180"
      />
    </summary>
  );
}

const SEO_ROW_CONTROL_CLASS =
  "focus-visible:ring-ring flex w-full cursor-pointer items-center gap-3 text-start outline-none focus-visible:ring-2";

/** A row that is one button: the whole row opens its target, and an arrow at its end says so. */
export const SEO_ROW_BUTTON_CLASS = cn(
  HOLDER_ITEM_CLASS,
  HOLDER_ITEM_HOVER_CLASS,
  SEO_ROW_CONTROL_CLASS,
);

/**
 * The next step of a list on Rankings: one row over the table that leads to the Actions tab.
 * The fill of a row and no outline: the table under it has the one frame of the card.
 */
export function SeoNextStepRow({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(SEO_ROW_BUTTON_CLASS, "border-0 px-4 py-2.5 text-sm")}
      onClick={onClick}
    >
      <span className="min-w-0 flex-1 font-medium">{children}</span>
      <ChevronRight className="text-muted-foreground size-4 shrink-0" />
    </button>
  );
}

/** Orange marks what hurts search most (critical and high), grey marks low; the text beside the mark carries the name. */
export const SEO_SEVERITY_MARK_CLASS: Record<
  "critical" | "major" | "minor",
  string
> = {
  critical: "bg-chart-2",
  major: "bg-chart-2",
  minor: "bg-chart-5",
};

/**
 * How much an issue affects search: a dot and a quiet line of text. The title
 * and the action of a row stay its loudest marks. The hint says what the level means.
 */
export function SeoSeverity({
  severity,
}: {
  severity: "critical" | "major" | "minor";
}) {
  const t = useTranslations("App.Seo");
  return (
    <span
      title={t(`severityHint.${severity}`)}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap",
        severity === "critical"
          ? "text-foreground font-medium"
          : "text-muted-foreground",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          SEO_SEVERITY_MARK_CLASS[severity],
        )}
      />
      {t(`severity.${severity}`)}
    </span>
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

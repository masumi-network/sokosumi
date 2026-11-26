import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { Check } from "lucide-react";
import { useState } from "react";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { cn } from "@/lib/utils";
import {
  SEO_ROW_LIST_CLASS,
  SEO_SEVERITY_MARK_CLASS,
  SeoDate,
  SeoFoldSummary,
  SeoMetaLine,
  SeoSection,
  SeoShowMore,
  seoPageName,
  seoSiteUrl,
} from "./seo-shared";
import {
  type SeoCrawlCheck,
  type SeoCrawlItem,
  type SeoCrawlKind,
  type SeoCrawlRow,
  type SeoCrawlStop,
  type SeoCrawlView,
  seoSiteCrawlView,
} from "./seo-site-crawl-model";

/** Entries a fold shows before its "show more" button. */
const FIRST_ITEMS = 5;
/** The mark at the start of a row: the same box for a dot, a ring and a check, so the labels line up. */
const MARK_BOX = "flex size-4 shrink-0 items-center justify-center";

/** The SEO bot's stop and kind words hold dots and spaces, which a message key cannot. */
const STOP_KEY = {
  complete: "complete",
  "page cap": "pageCap",
  "depth cap": "depthCap",
  "template cap": "templateCap",
  "link cap": "linkCap",
  time: "time",
  "rate limited": "rateLimited",
  "robots.txt": "robots",
  "fetch failed": "fetchFailed",
} as const satisfies Record<SeoCrawlStop, string>;
const KIND_KEY = {
  javascript: "javascript",
  loop: "loop",
  "too many hops": "tooManyHops",
  "target not 2xx": "targetNot2xx",
  "other host": "otherHost",
  conflicting: "conflicting",
  "changed in render": "changedInRender",
  "removed in render": "removedInRender",
  unreadable: "unreadable",
} as const satisfies Record<SeoCrawlKind, string>;

/** What the count of an entry, and the count a check left out, are counts of. */
const COUNT_KEY = {
  brokenLinks: "linkingPages",
  redirectChains: "linkingPages",
  duplicateTitles: "pages",
  javascript: "shellPages",
  noindexInSitemap: "pages",
  badCanonicals: "pages",
  missingTitle: "pages",
  missingH1: "pages",
  orphans: "pages",
} as const satisfies Record<SeoCrawlCheck, string>;
const LEFT_KEY = {
  brokenLinks: "links",
  redirectChains: "links",
  duplicateTitles: "compared",
  javascript: "seen",
  noindexInSitemap: "sitemapUrls",
  badCanonicals: "canonicals",
  missingTitle: "pages",
  missingH1: "pages",
  orphans: "pages",
} as const satisfies Record<SeoCrawlCheck, string>;

type T = ReturnType<typeof useSeoResultTranslations<"App.Seo.siteCrawl">>;
type Found = Extract<SeoCrawlRow, { state: "found" }>;
type Undecided = Extract<SeoCrawlRow, { state: "not determined" }>;

/** The ledger of the site audit's crawl: what it found on the whole site, what it could not decide, what passed. */
export function SeoSiteCrawl({
  workspace,
}: {
  workspace: ProjectSeoWorkspace;
}) {
  const t = useSeoResultTranslations("App.Seo.siteCrawl");
  const full = workspace.observations.find((row) => row.kind === "audit_full");
  const view = seoSiteCrawlView(full?.siteCrawl);
  if (!full || !view) return null;
  const site = seoSiteUrl(workspace);
  return (
    <SeoSection
      lang="en"
      title={t("title")}
      actions={
        <span className="self-center text-xs text-muted-foreground">
          <SeoDate report day value={full.observedAt} />
        </span>
      }
    >
      {view.state === "not crawled" ? (
        <ul className={SEO_ROW_LIST_CLASS}>
          <UndecidedRow title={t("notCrawled")} lines={[view.reason]} whole />
        </ul>
      ) : (
        <Crawled view={view} site={site} t={t} />
      )}
    </SeoSection>
  );
}

function Crawled({
  view,
  site,
  t,
}: {
  view: Extract<SeoCrawlView, { state: "crawled" }>;
  site: string | null;
  t: T;
}) {
  return (
    <>
      <SeoMetaLine
        className="px-2 text-xs tabular-nums"
        items={[
          ["read", t("read", { count: view.read })],
          [
            "stop",
            view.stop !== "complete" && t(`stop.${STOP_KEY[view.stop]}`),
          ],
        ]}
      />
      <ul className={SEO_ROW_LIST_CLASS}>
        {view.rows.map((row) =>
          row.state === "found" ? (
            <FoundRow key={row.check} row={row} site={site} t={t} />
          ) : (
            <UndecidedRow
              key={row.check}
              title={t(`checks.${row.check}`)}
              lines={undecidedLines(row, t)}
            />
          ),
        )}
        {view.clear.length > 0 && (
          <li className="flex items-start gap-3 px-4 py-2.5 text-sm">
            <span className={cn(MARK_BOX, "mt-0.5")}>
              <span className="check-pop stagger-delay flex size-4 items-center justify-center rounded-full bg-semantic-success text-semantic-success-foreground">
                <Check aria-hidden className="size-3" strokeWidth={3} />
              </span>
            </span>
            <span aria-hidden className="w-8 shrink-0" />
            <div className="min-w-0">
              <p>{t("clear")}</p>
              <SeoMetaLine
                className="text-xs"
                items={view.clear.map((check) => [check, t(`checks.${check}`)])}
              />
            </div>
          </li>
        )}
      </ul>
      {view.otherGaps.length > 0 && (
        <details className="px-2">
          <SeoFoldSummary className="min-h-11 text-xs text-muted-foreground sm:min-h-9">
            {t("otherGaps")}
          </SeoFoldSummary>
          <ul className="content-rise max-w-prose space-y-2 pb-2 text-xs">
            {view.otherGaps.map((gap) => (
              <li key={gap.item}>
                <span className="font-medium">{gap.item}</span>
                <span className="block text-muted-foreground">
                  {sentence(gap.reason)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

/** What a row says when the crawl could not decide: the bot's reasons, or how much it left out. */
function undecidedLines(row: Undecided, t: T) {
  const left = row.notDetermined
    ? [t(`left.${LEFT_KEY[row.check]}`, { count: row.notDetermined })]
    : [];
  if (row.reasons.length) return [...row.reasons, ...left];
  if (left.length) return left;
  return [
    t(
      row.check === "noindexInSitemap"
        ? "noSitemapPage"
        : row.check === "javascript"
          ? "olderReport"
          : "missing",
    ),
  ];
}

/** A check the crawl could not decide: a dash, no number, and why. It never reads as a pass. */
function UndecidedRow({
  title,
  lines,
  whole = false,
}: {
  title: string;
  lines: string[];
  /** The row stands for the whole crawl: no count column to line up with, and its title says the state. */
  whole?: boolean;
}) {
  const t = useSeoResultTranslations("App.Seo.siteCrawl");
  return (
    <li className="flex items-start gap-3 px-4 py-2.5 text-sm">
      {/* A dash: no value. A dashed ring read as a spinner, and grey dots already mean minor problems. */}
      <span aria-hidden className={cn(MARK_BOX, "mt-0.5")}>
        <span className="h-0.5 w-2.5 rounded-full bg-muted-foreground" />
      </span>
      {!whole && <span aria-hidden className="w-8 shrink-0" />}
      <div className="min-w-0 flex-1">
        <p>{title}</p>
        <p className="max-w-prose text-xs text-muted-foreground">
          {!whole && (
            <span className="font-medium text-foreground">
              {t("notDetermined")}.{" "}
            </span>
          )}
          {lines.map(sentence).join(" ")}
        </p>
      </div>
    </li>
  );
}

/** The SEO bot writes its reasons as clauses: shown alone, each reads as a sentence. */
function sentence(text: string) {
  const trimmed = text.trim();
  const start = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(start) ? start : `${start}.`;
}

function FoundRow({ row, site, t }: { row: Found; site: string | null; t: T }) {
  const seo = useSeoResultTranslations("App.Seo");
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? row.items : row.items.slice(0, FIRST_ITEMS);
  const name = (url: string) => seoPageName(url, site, "/");
  const first = row.items[0];
  return (
    <li>
      <details>
        <SeoFoldSummary className="min-h-11 gap-3 px-4 py-2.5 text-sm">
          <span aria-hidden className={MARK_BOX}>
            <span
              className={cn(
                "pop-in stagger-delay size-2 rounded-full",
                SEO_SEVERITY_MARK_CLASS[row.severity],
              )}
            />
          </span>
          {/* The dot's colour says the impact: a screen reader hears it in words. */}
          <span className="sr-only">{seo(`severity.${row.severity}`)}, </span>
          <span className="w-8 shrink-0 font-semibold tabular-nums">
            {row.total}
          </span>
          <span className="min-w-0 flex-1 sm:flex-none sm:shrink-0">
            {t(`checks.${row.check}`)}
          </span>
          {/* A glance at the first entry while the fold is shut; once open, the list says it. */}
          <span
            aria-hidden
            className={cn(
              "hidden min-w-0 flex-1 truncate text-end text-xs text-muted-foreground sm:block [details[open]>summary>&]:invisible",
              first?.url && "font-mono",
            )}
          >
            {first && (first.url ? name(first.label) : first.label)}
          </span>
        </SeoFoldSummary>
        {/* On a phone the list starts under the count, not the label: the URLs need the width. */}
        <div className="content-rise space-y-2 ps-11 pe-4 pb-3 text-sm sm:ps-22">
          {/* A list of bare addresses reads as one block; entries with facts need room between them. */}
          <ul
            className={cn(
              row.items.some((item) => item.urls || item.status != null)
                ? "space-y-2"
                : "space-y-0.5",
            )}
          >
            {shown.map((item) => (
              <Item
                key={item.label + (item.urls?.[0] ?? "")}
                item={item}
                row={row}
                name={name}
                t={t}
              />
            ))}
          </ul>
          {row.items.length > FIRST_ITEMS && (
            <div className="-ms-3">
              <SeoShowMore
                more={t("showMore", {
                  count: row.items.length - FIRST_ITEMS,
                })}
                expanded={expanded}
                onToggle={() => setExpanded((open) => !open)}
              />
            </div>
          )}
          <SeoMetaLine
            className="text-xs"
            items={[
              [
                "listed",
                row.total > row.items.length &&
                  t("listed", { listed: row.items.length, total: row.total }),
              ],
              [
                "left",
                row.notDetermined > 0 &&
                  t(`left.${LEFT_KEY[row.check]}`, {
                    count: row.notDetermined,
                  }),
              ],
            ]}
          />
          {row.candidates && (
            <p className="text-xs text-muted-foreground">{t("candidates")}</p>
          )}
        </div>
      </details>
    </li>
  );
}

function Item({
  item,
  row,
  name,
  t,
}: {
  item: SeoCrawlItem;
  row: Found;
  name: (url: string) => string;
  t: T;
}) {
  return (
    <li className="min-w-0">
      <p
        className={cn(
          "break-words",
          item.url && "font-mono text-xs leading-5 [overflow-wrap:anywhere]",
        )}
        title={item.url ? item.label : undefined}
      >
        {item.url ? name(item.label) : item.label}
        {row.check === "redirectChains" &&
          item.urls?.map((url, index) => (
            <span key={`${index}-${url}`} className="text-muted-foreground">
              {" → "}
              {name(url)}
            </span>
          ))}
      </p>
      {row.check !== "redirectChains" && item.urls && item.urls.length > 0 && (
        <p className="text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
          {row.check === "brokenLinks" && `${t("from")} `}
          <span className="font-mono">
            {row.check === "badCanonicals"
              ? `→ ${name(item.urls[0])}`
              : item.urls.map(name).join(" · ")}
          </span>
        </p>
      )}
      <SeoMetaLine
        className="text-xs tabular-nums"
        items={[
          ["kind", item.kind && t(`kind.${KIND_KEY[item.kind]}`)],
          [
            "status",
            item.status != null && t("status", { status: item.status }),
          ],
          [
            "count",
            item.count !== undefined &&
              t(`count.${COUNT_KEY[row.check]}`, { count: item.count }),
          ],
        ]}
      />
    </li>
  );
}

import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { Check } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { cn } from "@/lib/utils";
import { SeoCopyButton } from "./seo-action-copy";
import { seoPageKey } from "./seo-serp-features-model";
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
  itemFacts,
  LEFT_KEY,
  type SeoCrawlT,
  STOP_KEY,
  sentence,
  seoCrawlInstructions,
} from "./seo-site-crawl-copy";
import { SeoCrawlDeepAudit } from "./seo-site-crawl-deep-audit";
import {
  type SeoCrawlItem,
  type SeoCrawlRow,
  type SeoCrawlStop,
  type SeoCrawlView,
  seoCrawlContinuations,
  seoSiteCrawlView,
} from "./seo-site-crawl-model";

/** Entries a fold shows before its "show more" button. */
const FIRST_ITEMS = 5;
/** The mark at the start of a row: the same box for a dot, a ring and a check, so the labels line up. */
const MARK_BOX = "flex size-4 shrink-0 items-center justify-center";
/** More undecided checks than this sit behind one fold: the problems stay the first thing the ledger shows. */
const OPEN_UNDECIDED = 3;

type T = SeoCrawlT;
type Found = Extract<SeoCrawlRow, { state: "found" }>;
type Undecided = Extract<SeoCrawlRow, { state: "not determined" }>;
/** A URL as text, or as a button that opens the Audit's own checks of that page. */
type PageText = (url: string, text: string) => ReactNode;

/** The ledger of the site audit's crawl: what it found on the whole site, what it could not decide, what passed. */
export function SeoSiteCrawl({
  workspace,
  openPage,
  action,
}: {
  workspace: ProjectSeoWorkspace;
  /** Shows the Audit's checks of one of its pages. */
  openPage: (pageId: string) => void;
  /** The section's own action, beside its date. */
  action?: ReactNode;
}) {
  const t = useSeoResultTranslations("App.Seo.siteCrawl");
  const full = workspace.observations.find((row) => row.kind === "audit_full");
  const view = seoSiteCrawlView(full?.siteCrawl);
  if (!full || !view) return null;
  const site = seoSiteUrl(workspace);
  const pageIds = new Map(
    workspace.pages.map((page) => [seoPageKey(page.url), page.id]),
  );
  const pageText: PageText = (url, text) => {
    const id = URL.canParse(url) ? pageIds.get(seoPageKey(url)) : undefined;
    if (!id) return text;
    return (
      <button
        type="button"
        className="focus-visible:ring-ring cursor-pointer rounded-sm text-start underline decoration-muted-foreground underline-offset-2 outline-none hover:decoration-current focus-visible:ring-2"
        onClick={() => openPage(id)}
      >
        {text}
        <span className="sr-only">: {t("openPage")}</span>
      </button>
    );
  };
  const continuations = seoCrawlContinuations(
    workspace.observations,
    full.siteCrawl,
  );
  // The action goes on from the crawl Core offers: an older audit on screen must not buy a newer audit's pages.
  const tip =
    continuations[0]?.siteCrawl.snapshotId ??
    (full.siteCrawl?.state === "crawled"
      ? full.siteCrawl.snapshotId
      : undefined);
  const offered =
    tip !== undefined && tip === workspace.availableActions.continueCrawlFrom;
  return (
    <SeoSection
      lang="en"
      title={t("title")}
      actions={
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted-foreground">
            <SeoDate report day value={full.observedAt} />
          </span>
          {offered && action}
        </div>
      }
    >
      {view.state === "not crawled" ? (
        <ul className={SEO_ROW_LIST_CLASS}>
          <UndecidedRow title={t("notCrawled")} lines={[view.reason]} whole />
        </ul>
      ) : (
        <Crawled view={view} site={site} pageText={pageText} t={t} />
      )}
      {continuations.map((row) => {
        const next = seoSiteCrawlView(row.siteCrawl);
        if (next?.state !== "crawled") return null;
        return (
          // A paid continuation may repeat an earlier Snapshot: its own observation keys its fold.
          <details key={row.id} className="border-t">
            <SeoFoldSummary className="min-h-11 gap-3 px-2 py-2.5 text-sm">
              <span className="font-medium">{t("next.heading")}</span>
              <span className="text-xs text-muted-foreground">
                <SeoDate report day value={row.observedAt} />
              </span>
            </SeoFoldSummary>
            <div className="content-rise space-y-2">
              <Crawled view={next} site={site} pageText={pageText} t={t} />
              {row.siteCrawl.deepAudit && (
                <SeoCrawlDeepAudit
                  audit={row.siteCrawl.deepAudit}
                  page={(url) => pageText(url, url)}
                />
              )}
            </div>
          </details>
        );
      })}
    </SeoSection>
  );
}

function Crawled({
  view,
  site,
  pageText,
  t,
}: {
  view: Extract<SeoCrawlView, { state: "crawled" }>;
  site: string | null;
  pageText: PageText;
  t: T;
}) {
  const found = view.rows.filter((row) => row.state === "found");
  const undecided = view.rows.filter((row) => row.state === "not determined");
  const undecidedRows = (stated: boolean) =>
    undecided.map((row) => (
      <UndecidedRow
        key={row.check}
        title={t(`checks.${row.check}`)}
        lines={undecidedLines(row, t)}
        stated={stated}
      />
    ));
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
        {found.map((row) => (
          <FoundRow
            key={row.check}
            row={row}
            stop={view.stop}
            site={site}
            pageText={pageText}
            t={t}
          />
        ))}
        {undecided.length > OPEN_UNDECIDED ? (
          <li>
            <details>
              <SeoFoldSummary className="min-h-11 gap-3 px-4 py-2.5 text-sm">
                <UndecidedMark />
                <span aria-hidden className="w-8 shrink-0" />
                <span>{t("undecided", { count: undecided.length })}</span>
              </SeoFoldSummary>
              {/* The fold's title says the state: the rows inside do not repeat it. */}
              <ul className="content-rise">{undecidedRows(true)}</ul>
            </details>
          </li>
        ) : (
          undecidedRows(false)
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
                <span className="block text-muted-foreground [overflow-wrap:anywhere]">
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
  return [t(row.empty)];
}

/** A check the crawl could not decide: a dash, no number, and why. It never reads as a pass. */
/** A dash: no value. A dashed ring read as a spinner, and grey dots already mean minor problems. */
function UndecidedMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn(MARK_BOX, className)}>
      <span className="h-0.5 w-2.5 rounded-full bg-muted-foreground" />
    </span>
  );
}

function UndecidedRow({
  title,
  lines,
  whole = false,
  stated = false,
}: {
  title: string;
  lines: string[];
  /** The row stands for the whole crawl: no count column to line up with, and its title says the state. */
  whole?: boolean;
  /** A fold around the row already says "not determined". */
  stated?: boolean;
}) {
  const t = useSeoResultTranslations("App.Seo.siteCrawl");
  return (
    <li className="flex items-start gap-3 px-4 py-2.5 text-sm">
      <UndecidedMark className="mt-0.5" />
      {!whole && <span aria-hidden className="w-8 shrink-0" />}
      <div className="min-w-0 flex-1">
        <p>{title}</p>
        <p className="max-w-prose text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {!whole && !stated && (
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

function FoundRow({
  row,
  stop,
  site,
  pageText,
  t,
}: {
  row: Found;
  stop: SeoCrawlStop;
  site: string | null;
  pageText: PageText;
  t: T;
}) {
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
                // A page can hold two canonical findings: the kind tells them apart.
                key={[item.label, item.kind, item.urls?.[0]].join("\n")}
                item={item}
                row={row}
                name={name}
                pageText={pageText}
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
          {row.reasons.length > 0 && (
            <p className="max-w-prose text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {row.reasons.map(sentence).join(" ")}
            </p>
          )}
          <SeoCopyButton
            text={seoCrawlInstructions(row, stop, t)}
            label={t("copy.button")}
          />
        </div>
      </details>
    </li>
  );
}

function Item({
  item,
  row,
  name,
  pageText,
  t,
}: {
  item: SeoCrawlItem;
  row: Found;
  name: (url: string) => string;
  pageText: PageText;
  t: T;
}) {
  const page = (url: string) => pageText(url, name(url));
  return (
    <li className="min-w-0">
      <p
        className={cn(
          "break-words",
          item.url && "font-mono text-xs leading-5 [overflow-wrap:anywhere]",
        )}
        title={item.url ? item.label : undefined}
      >
        {item.url ? page(item.label) : item.label}
        {row.check === "redirectChains" &&
          item.urls?.map((url, index) => (
            <span key={`${index}-${url}`} className="text-muted-foreground">
              {" → "}
              {page(url)}
            </span>
          ))}
      </p>
      {row.check !== "redirectChains" && item.urls && item.urls.length > 0 && (
        <p className="text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
          {row.check === "brokenLinks" && `${t("from")} `}
          <span className="font-mono">
            {row.check === "badCanonicals" ? (
              <>→ {page(item.urls[0])}</>
            ) : (
              item.urls.map((url, index) => (
                <span key={`${index}-${url}`}>
                  {index > 0 && " · "}
                  {page(url)}
                </span>
              ))
            )}
          </span>
        </p>
      )}
      <SeoMetaLine
        className="text-xs tabular-nums"
        items={itemFacts(item, row.check, t).map((fact) => [fact, fact])}
      />
    </li>
  );
}

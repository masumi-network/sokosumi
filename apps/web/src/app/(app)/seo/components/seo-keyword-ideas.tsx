"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SEO_RESULT_LOCALE } from "@/i18n/seo-result-messages";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { SeoExportMenu } from "./seo-export-menu";
import { seoKeywordIdeasExport } from "./seo-export-model";
import {
  SEO_DIFFICULTY_COLUMN_CLASS,
  SeoDifficultyCell,
} from "./seo-keyword-difficulty";
import { SeoKeywordDraftDetails } from "./seo-keyword-draft-details";
import { type SeoKeywordGroup } from "./seo-keyword-rows-model";
import {
  assessKeywordIdeas,
  type IdeaAssessment,
  priorityFirst,
} from "./seo-keyword-shortlist";
import { SEO_LIST_PAGE_SIZE } from "./seo-list-model";
import {
  SEO_COMPACT_ROWS_CLASS,
  SeoBarNumber,
  SeoPageText,
  SeoSection,
  SeoShowMore,
  seoIsOnlyPrimary,
  seoMarketName,
} from "./seo-shared";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** Keywords a check found but read no position for: one row each, a high or medium conversion estimate first, then the most searched. */
export function SeoKeywordIdeas({
  model,
  ideas,
  comparisonIdeas = ideas,
}: {
  model: SeoWorkspaceModel;
  ideas: SeoKeywordGroup[];
  comparisonIdeas?: SeoKeywordGroup[];
}) {
  const t = useTranslations("App.Seo");
  const result = useSeoResultTranslations("App.Seo");
  const [expanded, setExpanded] = useState(false);
  if (!ideas.length) return null;
  // A search already narrows the list; it shows every match.
  const assessments = assessKeywordIdeas(ideas, comparisonIdeas);
  const assess = (group: SeoKeywordGroup) => assessments.get(group.lead.id)!;
  const ordered = ideas.toSorted((a, b) => priorityFirst(assess(a), assess(b)));
  const priorityCount = ordered.filter(
    (group) => assess(group).reason === "priority",
  ).length;
  const visible = priorityCount || SEO_LIST_PAGE_SIZE;
  const rows =
    expanded || model.keywordSearch ? ordered : ordered.slice(0, visible);
  const shown = {
    volume: ideas.some((group) => group.volume !== null),
    // Only a check that reads keyword difficulty fills the column.
    difficulty: ideas.some((group) => group.difficulty !== null),
    // Only a check that estimates conversion fills the column.
    gain: ideas.some((group) => group.clicks != null),
    // One reason on every row in view tells no idea from another: "Related search" stood on ten of ten rows.
  };
  // A row names its page only when it is not the primary page: the header says "and its page" only when a row in
  // view names one.
  const manyPages = model.data.scope.pageIds.length > 1;
  const pageNamed =
    manyPages &&
    rows.some(
      ({ lead }) => lead.pageUrl && !seoIsOnlyPrimary(model.data, lead.pageUrl),
    );
  // The bars set each idea against the most searched row in view: the list leads with the best ideas, not the
  // most searched, so a scale from beyond the fold left the bars in view near empty.
  const mostSearched = Math.max(0, ...rows.map((group) => group.volume ?? 0));
  // "Track" saves the row's market: with several, each row names its own.
  const manyMarkets =
    new Set(ideas.map(({ lead }) => `${lead.countryCode}:${lead.languageCode}`))
      .size > 1;
  return (
    <SeoSection
      title={t("keywords.ideas.title", { count: ideas.length })}
      // The three lists of the switch start with a title of one size.
      strong
      actions={
        // Every idea the search matches, not only the rows in view, with the difficulty of each.
        <SeoExportMenu
          name="keyword-ideas"
          titleKey="keywords.ideas.name"
          workspace={model.data}
          table={(report) =>
            seoKeywordIdeasExport(ordered, assessments, report)
          }
        />
      }
      // The one Track sentence: it names the next position check, so it has no place where none can run.
      // The Keywords list has none, because a check tracks its keywords from the start.
      description={result(
        priorityCount
          ? "keywords.shortlist.summary"
          : "keywords.shortlist.none",
      )}
    >
      <div className={HOLDER_ITEM_CLASS}>
        <Table className={SEO_COMPACT_ROWS_CLASS}>
          <TableHeader>
            <TableRow>
              <TableHead>
                {t(pageNamed ? "keywords.keywordAndPage" : "keywords.keyword")}
              </TableHead>
              {shown.volume ? (
                <TableHead className="text-right">
                  {t("keywords.volume")}
                </TableHead>
              ) : null}
              {shown.difficulty ? (
                <TableHead className={SEO_DIFFICULTY_COLUMN_CLASS}>
                  {t("keywords.difficulty.title")}
                </TableHead>
              ) : null}
              {shown.gain ? (
                <TableHead className="text-right">
                  {t("keywords.shortlist.gain")}
                </TableHead>
              ) : null}
              <TableHead>
                <span className="sr-only">{t("queries.rowActions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((group, index) => (
              <Fragment key={group.lead.id}>
                {priorityCount > 0 &&
                  (index === 0 || index === priorityCount) && (
                    <TableRow className="bg-muted">
                      <TableCell
                        colSpan={
                          2 +
                          Number(shown.volume) +
                          Number(shown.gain) +
                          Number(shown.difficulty)
                        }
                        className="text-xs font-semibold"
                      >
                        {t(
                          index === 0
                            ? "keywords.shortlist.group"
                            : "keywords.shortlist.other",
                          {
                            count:
                              index === 0
                                ? priorityCount
                                : ordered.length - priorityCount,
                          },
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                <SeoIdeaRow
                  assessment={assess(group)}
                  group={group}
                  model={model}
                  shown={shown}
                  manyMarkets={manyMarkets}
                  manyPages={manyPages}
                  mostSearched={mostSearched}
                />
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
      {model.data.availableActions.canEdit &&
        model.data.availableActions.canUsePaidSearchData && (
          <p className="text-muted-foreground px-2 text-xs">
            {result("keywords.help")}
          </p>
        )}
      {ideas.length > visible && !model.keywordSearch ? (
        <SeoShowMore
          more={t("keywords.ideas.more", {
            count: ideas.length - visible,
          })}
          expanded={expanded}
          onToggle={() => setExpanded((open) => !open)}
        />
      ) : null}
    </SeoSection>
  );
}

/**
 * The keyword with a small info button: a click opens why the idea is listed under it, a second click closes it.
 * A line on every row made the list busy (owner, 2026-11-13).
 */
function SeoIdeaRow({
  assessment,
  group,
  model,
  shown,
  manyMarkets,
  manyPages,
  mostSearched,
}: {
  group: SeoKeywordGroup;
  model: SeoWorkspaceModel;
  assessment: IdeaAssessment;
  shown: { volume: boolean; difficulty: boolean; gain: boolean };
  manyMarkets: boolean;
  manyPages: boolean;
  mostSearched: number;
}) {
  const t = useTranslations("App.Seo");
  const result = useSeoResultTranslations("App.Seo");
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const id = useId();
  const { lead, volume, difficulty } = group;
  return (
    <>
      <TableRow
        data-state={open ? "selected" : undefined}
        className="cursor-pointer"
        onClick={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest("button, a")
          )
            return;
          if (window.getSelection()?.toString()) return;
          setOpen((value) => !value);
        }}
      >
        <TableCell className="min-w-48 whitespace-normal">
          <button
            ref={toggle}
            type="button"
            aria-expanded={open}
            aria-controls={open ? id : undefined}
            onClick={() => setOpen((value) => !value)}
            // 32 px to hit around a 14 px icon, pulled back so the row keeps its height.
            className="focus-visible:ring-ring inline-flex min-h-8 items-center gap-2 rounded-sm text-start font-medium focus-visible:ring-2"
          >
            <ChevronDown
              aria-hidden
              className={
                open ? "size-3.5 shrink-0" : "size-3.5 shrink-0 -rotate-90"
              }
            />
            <bdi lang={lead.languageCode ?? ""}>{lead.keyword}</bdi>
          </button>
          {manyMarkets ? (
            <p className="text-muted-foreground text-xs">
              {seoMarketName(
                SEO_RESULT_LOCALE,
                lead.countryCode,
                lead.languageCode,
              )}
            </p>
          ) : null}
          {manyPages && lead.pageUrl ? (
            <SeoPageText
              url={lead.pageUrl}
              workspace={model.data}
              skipPrimary
              oneLine
            />
          ) : null}
        </TableCell>
        {shown.volume ? (
          <TableCell
            className="text-right tabular-nums"
            // No number, no unit: the label names the empty value.
            data-label={volume === null ? t("keywords.volume") : undefined}
          >
            {volume === null ? (
              <span className="text-muted-foreground">{result("none")}</span>
            ) : (
              <SeoBarNumber
                value={volume}
                max={mostSearched}
                unit={result("keywords.volumeUnit", { count: volume })}
              />
            )}
          </TableCell>
        ) : null}
        {shown.difficulty ? (
          <SeoDifficultyCell difficulty={difficulty} />
        ) : null}
        {shown.gain ? (
          <TableCell
            className="text-right tabular-nums"
            data-label={t("keywords.shortlist.gain")}
          >
            {assessment.extra !== null
              ? result("keywords.shortlist.clicks", { count: assessment.extra })
              : result("none")}
          </TableCell>
        ) : null}
        <TableCell>
          {model.data.availableActions.canEdit ? (
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                disabled={model.pending}
                onClick={() => {
                  void model.toggleKeyword(lead);
                }}
              >
                {t(lead.saved ? "keywords.unsave" : "keywords.save")}
              </Button>
            </div>
          ) : null}
        </TableCell>
      </TableRow>
      {open && (
        <TableRow className="bg-muted hover:bg-muted">
          <TableCell
            id={id}
            colSpan={
              2 +
              Number(shown.volume) +
              Number(shown.difficulty) +
              Number(shown.gain)
            }
            className="whitespace-normal"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setOpen(false);
                toggle.current?.focus();
              }
            }}
          >
            <SeoKeywordDraftDetails
              assessment={assessment}
              group={group}
              model={model}
            />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

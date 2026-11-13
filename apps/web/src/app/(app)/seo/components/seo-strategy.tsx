"use client";

import type { ProjectSeoStrategy } from "@sokosumi/core-client";
import { Check, Copy, WandSparkles } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { useClipboard } from "@/hooks/use-clipboard";
import { cn } from "@/lib/utils";
import { SeoActionCardHead } from "./seo-card-head";
import { type SeoPlaceEase, seoPlaces } from "./seo-places-model";
import {
  SEO_ROW_LIST_CLASS,
  SeoDate,
  SeoFoldSummary,
  SeoPageLink,
  SeoSection,
  SeoShowMore,
  SeoSource,
  seoFoldCount,
} from "./seo-shared";
import {
  SEO_STRATEGY_PLACE_FORMS,
  SEO_STRATEGY_REACHES,
  SEO_STRATEGY_VERDICTS,
  type SeoStrategyGroup,
  seoKeywordDemand,
  seoStrategyCounts,
  seoStrategyKey,
  seoStrategyPlaceHost,
  seoStrategyReason,
  seoStrategyTargetNotes,
} from "./seo-strategy-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** Under the fixes the list starts with this many actions: eight rows after five fix rows read as one long list. */
const SEO_STRATEGY_ACTIONS_AFTER_FIXES = 3;
/** The brand colour marks the places that are easy to get onto, orange the medium ones, grey the hard ones; the word beside the mark carries the name. Yellow did not show on white. */
const EASE_MARK_CLASS: Record<SeoPlaceEase, string> = {
  easy: "bg-primary",
  medium: "bg-chart-2",
  hard: "bg-chart-5",
};

function useStrategyLabels() {
  const t = useTranslations("App.Seo");
  return {
    verdict: (word: string) => {
      const key = seoStrategyKey(SEO_STRATEGY_VERDICTS, word);
      return key ? t(`strategy.verdict.${key}`) : word;
    },
    reach: (word: string) => {
      const key = seoStrategyKey(SEO_STRATEGY_REACHES, word);
      // A keyword row never says "ranks" or "open" (seoKeywordDemand), so they have no label.
      return key && key !== "ranks" && key !== "open"
        ? t(`strategy.reach.${key}`)
        : word;
    },
    // A count with its noun: "12" beside "In reach" did not say 12 of what.
    reachCount: (word: string, count: number, first: boolean) => {
      const key = seoStrategyKey(SEO_STRATEGY_REACHES, word);
      return key
        ? t(`strategy.reachCount.${key}`, {
            count,
            // The first count says what a group is ("groups of similar keywords"); the next ones say "groups".
            groups: t("strategy.groups", {
              count,
              first: first ? "true" : "false",
            }),
          })
        : `${count} ${word}`;
    },
  };
}

/**
 * The Agent card's line: the site audit's keyword result in one sentence. The Rankings tab holds its numbers.
 * "Keep these keywords" asks for nothing, so the card does not say it; a result that asks for a change shows.
 */
export function SeoStrategyLine({
  strategy,
}: {
  strategy: ProjectSeoStrategy | null | undefined;
}) {
  const t = useTranslations("App.Seo");
  const labels = useStrategyLabels();
  if (
    !strategy ||
    seoStrategyKey(SEO_STRATEGY_VERDICTS, strategy.verdict) === "keep"
  )
    return null;
  return (
    <p className="text-sm" data-testid="seo-agent-strategy">
      <span className="text-muted-foreground">{t("strategy.title")}: </span>
      {labels.verdict(strategy.verdict)}
    </p>
  );
}

/**
 * The site audit's result for the keywords, as one closed line under the keyword list: the verdict. Open, it adds
 * how many keyword groups the site can reach, the reason, and the check the result comes from when the list's
 * own date line does not name it.
 * As a card over the list it stood over the result of the list and over the ideas, with the words of an analyst.
 */
export function SeoStrategyFold({
  model,
  dated,
}: {
  model: SeoWorkspaceModel;
  /** The date line of the keyword list already names the check of the strategy, or opens the same results. */
  dated: boolean;
}) {
  const t = useTranslations("App.Seo");
  const labels = useStrategyLabels();
  const strategy = model.data.strategy;
  if (!strategy) return null;
  const reason = seoStrategyReason(strategy);
  const counts = seoStrategyCounts(strategy.groups);
  // The first count the page has words for says what a group is.
  const firstCount = counts.reaches.findIndex(
    ({ reach }) => seoStrategyKey(SEO_STRATEGY_REACHES, reach) !== null,
  );
  return (
    <details className="px-2 text-sm">
      <SeoFoldSummary className="py-2.5">
        <span className="min-w-0 break-words">
          <span className="text-muted-foreground">{t("strategy.title")}: </span>
          <span className="font-medium" data-testid="seo-strategy-verdict">
            {labels.verdict(strategy.verdict)}
          </span>
        </span>
      </SeoFoldSummary>
      <div className="max-w-prose space-y-2 pb-2">
        {/* The counts lead: they are the reader's own words. The sentence of the audit follows them, quieter. */}
        {counts.reaches.length || reason.moving.length ? (
          <ul role="list" className="space-y-1.5">
            {counts.reaches.map(({ reach, count }, index) => {
              const key = seoStrategyKey(SEO_STRATEGY_REACHES, reach);
              return (
                <li key={reach}>
                  <span className="tabular-nums">
                    {labels.reachCount(reach, count, index === firstCount)}
                  </span>
                  {/* What a count means stands with its count. As one paragraph after all counts, a sentence
                      stood far from its number. A reach that no count names gets no sentence. */}
                  {key === "ranks" || key === "inReach" || key === "open" ? (
                    <span className="text-muted-foreground block">
                      {t(`strategy.reachHelp.${key}`)}
                    </span>
                  ) : null}
                </li>
              );
            })}
            {reason.moving.length ? (
              <li className="space-y-1">
                {/* The count is the count of the audit's lines under it. One line can say "rises", so it counts
                    the groups that move. After the sentence of the audit the lines read as a part of that sentence. */}
                <span className="block tabular-nums">
                  {t("strategy.moving", { count: reason.moving.length })}
                </span>
                <StrategyLines lines={reason.moving} />
              </li>
            ) : null}
          </ul>
        ) : null}
        <p
          className={cn(
            "break-words",
            counts.reaches.length > 0 && "text-muted-foreground",
          )}
        >
          {reason.lead}
        </p>
        {reason.niche ? <p className="break-words">{reason.niche}</p> : null}
        <StrategyLines lines={reason.notes} />
        {dated ? null : (
          <p className="text-muted-foreground">
            {/* The date is the link to the results of the check. */}
            <SeoSource
              observationId={strategy.observationId}
              workspace={model.data}
            >
              {t("strategy.from")} <SeoDate day value={strategy.observedAt} />
            </SeoSource>
          </p>
        )}
      </div>
    </details>
  );
}

/** Lines of the audit's reason: one per keyword, or a note. */
function StrategyLines({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <ul className="text-muted-foreground list-disc space-y-1 ps-4">
      {lines.map((line, index) => (
        <li key={`${index}:${line}`} className="break-words">
          {line}
        </li>
      ))}
    </ul>
  );
}

/**
 * Under a keyword: the reach of its group, and the direction of its searches when they move.
 * The recent number stood here over the row's own searches: two numbers with one name. The strategy line has it.
 */
export function SeoKeywordDemand({
  group,
  keyword,
}: {
  group: SeoStrategyGroup | undefined;
  keyword: string;
}) {
  const t = useTranslations("App.Seo");
  const labels = useStrategyLabels();
  const demand = seoKeywordDemand(group, keyword);
  if (!demand) return null;
  const parts = [
    demand.reach ? labels.reach(demand.reach) : null,
    demand.trend ? t(`strategy.trend.${demand.trend}`) : null,
  ].filter((part): part is string => part !== null);
  return (
    <p className="text-muted-foreground mt-1 text-xs">{parts.join(" · ")}</p>
  );
}

/** The text the audit wrote for a promotion place. The owner reads it, copies it and posts it. */
function StrategyDraft({ text, titleId }: { text: string; titleId: string }) {
  const t = useTranslations("App.Seo");
  const { copied, copy } = useClipboard({
    copySuccessMessage: t("strategy.draft.copied"),
    copyErrorMessage: t("strategy.draft.copyError"),
  });
  return (
    <div className="max-w-prose space-y-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{t("strategy.draft.title")}</p>
        <Button
          size="sm"
          variant="outline"
          aria-describedby={titleId}
          onClick={() => void copy(text)}
        >
          {copied ? <Check /> : <Copy />}
          {t("strategy.draft.copy")}
        </Button>
      </div>
      <p className="text-muted-foreground">{t("strategy.draft.help")}</p>
      {/* A model wrote the text, so it shows as plain text. Its line breaks are part of the post. It is in the site's language, which can read from right to left. */}
      <p
        dir="auto"
        className="bg-muted rounded-md p-3 break-words whitespace-pre-wrap"
        data-testid="seo-strategy-draft"
      >
        {text}
      </p>
    </div>
  );
}

/**
 * One action of the keyword strategy. Closed, it is one row: the title and the effort, so a list of
 * actions reads as a list. Open, it adds the reason, the places, the limit, the suggested text and the button.
 */
function StrategyActionCard({
  action,
  model,
  startOpen,
  title = action.title,
  page,
  meta,
  note,
}: {
  action: ProjectSeoStrategy["actions"][number];
  model: SeoWorkspaceModel;
  /** The one action of a list has nothing to choose from, so it starts open. So does the first action after a row that led here. */
  startOpen: boolean;
  /** A place row names the place. */
  title?: string;
  /** The page of a listing place, quiet under its site. */
  page?: string | null;
  /** Beside the title instead of the effort. */
  meta?: ReactNode;
  /** The first line of the open card. */
  note?: string;
}) {
  const t = useTranslations("App.Seo");
  // Every card has the same button name; the card's title tells them apart.
  const titleId = useId();
  const bodyId = useId();
  // Null until the reader presses the row: the start state follows the list, also when the list changes.
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? startOpen;
  return (
    <article className={cn(HOLDER_ITEM_CLASS, "min-w-0")}>
      <h3>
        <SeoActionCardHead
          bodyId={bodyId}
          open={open}
          onToggle={() => setToggled(!open)}
        >
          <span className="min-w-0 flex-1 gap-3 sm:flex sm:items-center">
            {/* The page belongs to the name: two pages of one site have the same task. */}
            <span id={titleId} className="block min-w-0 sm:flex-1">
              <span
                // Plain wrap: a heading balances its lines, so the same title broke at another word here than
                // on the Agent tab.
                className="block text-sm font-medium text-wrap break-words"
              >
                {title}
              </span>
              {page ? (
                <span className="text-muted-foreground block text-xs font-normal break-words">
                  {page}
                </span>
              ) : null}
            </span>
            {/* Quiet plain text, as the impact of a fix row. Two outlined labels on every row made the list a
                list of labels, and the title already says what kind of action it is. */}
            <span className="text-muted-foreground block text-xs font-normal whitespace-nowrap max-sm:mt-0.5">
              {meta ??
                `${t("actions.effort")}: ${t(`priority.${action.effort}`)}`}
            </span>
          </span>
        </SeoActionCardHead>
      </h3>
      {open ? (
        <StrategyActionBody
          action={action}
          model={model}
          bodyId={bodyId}
          titleId={titleId}
          note={note}
        />
      ) : null}
    </article>
  );
}

/** What an open strategy action adds under its title row. */
function StrategyActionBody({
  action,
  model,
  bodyId,
  titleId,
  note,
}: {
  action: ProjectSeoStrategy["actions"][number];
  model: SeoWorkspaceModel;
  bodyId: string;
  titleId: string;
  note?: string;
}) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const placeForm = action.place
    ? seoStrategyKey(SEO_STRATEGY_PLACE_FORMS, action.place.form)
    : null;
  // The name is the bot's word, so the site the link opens shows beside it.
  const placeNotes = action.place
    ? [
        placeForm ? t(`strategy.placeForm.${placeForm}`) : null,
        seoStrategyPlaceHost(action.place),
      ].filter((note): note is string => note !== null)
    : [];
  // A promotion action has one place. Its targets are the threads that show the place, so the question names the place.
  const places = action.place
    ? [action.place.url]
    : action.targets.map((target) => target.url);
  // One type on every place of a list tells no place from another: "List of products" stood on four lines.
  const oneType =
    action.targets.length > 1 &&
    new Set(action.targets.map((target) => target.type)).size === 1;
  return (
    <div id={bodyId} className="content-rise space-y-3 px-4 pt-1 pb-4">
      {note ? <p className="max-w-prose text-sm font-medium">{note}</p> : null}
      {action.why ? (
        <p className="text-muted-foreground max-w-prose text-sm break-words">
          {action.why}
        </p>
      ) : null}
      {action.place ? (
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium">
            {t("strategy.actions.place")}
          </span>
          <SeoPageLink url={action.place.url} label={action.place.name} />
          {placeNotes.length ? (
            <span className="text-muted-foreground text-xs">
              {placeNotes.join(" · ")}
            </span>
          ) : null}
        </p>
      ) : null}
      {action.targets.length ? (
        <ul role="list" className="space-y-2.5">
          {action.targets.map((target, index) => {
            const keys = seoStrategyTargetNotes(target);
            const notes = [
              keys.type && !oneType
                ? t(`strategy.targetType.${keys.type}`)
                : null,
              keys.state ? t(`strategy.targetState.${keys.state}`) : null,
            ].filter((note): note is string => note !== null);
            return (
              <li
                key={`${index}:${target.url}`}
                className="flex flex-wrap items-baseline gap-x-2"
              >
                <SeoPageLink quiet url={target.url} label={target.title} />
                {notes.length ? (
                  <span className="text-muted-foreground text-xs">
                    {notes.join(" · ")}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <dl className="max-w-prose space-y-2 text-sm">
        <div>
          <dt className="font-medium">{t("actions.effect")}</dt>
          <dd className="text-muted-foreground break-words">
            {action.expectedEffect}
          </dd>
        </div>
        {action.limit ? (
          // The limit is part of the advice: the action is only right inside it.
          <div>
            <dt className="font-medium">{t("strategy.actions.limit")}</dt>
            <dd className="text-muted-foreground break-words">
              {action.limit}
            </dd>
          </div>
        ) : null}
      </dl>
      {action.draft ? (
        <StrategyDraft text={action.draft} titleId={titleId} />
      ) : null}
      {model.data.auditId ? (
        <Button
          size="sm"
          variant="outline"
          aria-describedby={titleId}
          onClick={() => {
            model.openChat(
              t("strategy.actions.prompt", {
                title: action.title,
                count: places.length,
                targets: format.list(places),
                // An action without a limit must not send the agent to look for one.
                hasLimit: action.limit ? "yes" : "no",
                limit: action.limit ?? "",
              }),
            );
          }}
        >
          <WandSparkles />
          {t("agent.askHow")}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Why the audit has no action or no ready text for a promotion place: a call that failed, a community whose terms
 * ban promotion. A section of its own, so it shows also when the audit has no action.
 */
export function SeoStrategyPlaceNotes({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const notes = model.data.strategy?.placesNotes ?? [];
  if (!notes.length) return null;
  return (
    <SeoSection
      title={t("strategy.places.title")}
      description={t("strategy.places.help")}
    >
      <div
        className="max-w-prose px-2 pb-2 text-sm"
        data-testid="seo-strategy-place-notes"
      >
        <StrategyLines lines={notes} />
      </div>
    </SeoSection>
  );
}

/**
 * The actions of the audit's keyword strategy: a listing on another site, a new page, a page with a new target,
 * a place to promote the product in.
 * None is one page edit, so none has a draft Task. The button puts a question in the chat field and sends nothing.
 */
export function SeoStrategyActions({
  model,
  afterFixes = false,
}: {
  model: SeoWorkspaceModel;
  /** The list stands under the fixes of the tab. Alone on the tab, it is the page and shows a full list. */
  afterFixes?: boolean;
}) {
  const t = useTranslations("App.Seo");
  // A row that names these actions (Agent tab, Competitors list) leads here: the reader sees the count it named.
  const { shownStrategy, setShownStrategy } = model;
  // The list is open on its first paint then, so the group scrolls into view at its full height.
  const [expanded, setExpanded] = useState(shownStrategy);
  const [placesOpen, setPlacesOpen] = useState(shownStrategy);
  // The reader came for these actions: the first one is open, as the first fix is, so eight equal rows have a
  // lead. The longer group also has room to scroll up to the top of a desktop screen.
  const [led, setLed] = useState(shownStrategy);
  const group = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!shownStrategy) return;
    setExpanded(true);
    setPlacesOpen(true);
    setLed(true);
    group.current?.scrollIntoView({ block: "start" });
    group.current?.focus({ preventScroll: true });
    setShownStrategy(false);
  }, [shownStrategy, setShownStrategy]);
  const { places, rest: actions } = seoPlaces(
    model.data.strategy?.actions ?? [],
  );
  if (!actions.length && !places.length) return null;
  const fold = afterFixes ? SEO_STRATEGY_ACTIONS_AFTER_FIXES : undefined;
  const visible = seoFoldCount(actions.length, fold);
  const placesVisible = seoFoldCount(places.length, fold);
  return (
    <div
      ref={group}
      // It takes the focus after such a row, so a screen reader names it.
      role="group"
      aria-label={t("strategy.title")}
      tabIndex={-1}
      // On a phone the app header lies over the top of the scroll area.
      className="focus-visible:outline-ring scroll-mt-20 space-y-5 rounded-xl focus-visible:outline-2 md:scroll-mt-4"
    >
      {/* The title says where the actions come from: a sentence under it said the same. */}
      {actions.length ? (
        <SeoSection title={t("strategy.actions.title")}>
          <ul role="list" className={SEO_ROW_LIST_CLASS}>
            {(expanded ? actions : actions.slice(0, visible)).map(
              (action, index) => (
                <li key={`${index}:${action.title}`}>
                  <StrategyActionCard
                    action={action}
                    model={model}
                    startOpen={actions.length === 1 || (led && index === 0)}
                  />
                </li>
              ),
            )}
          </ul>
          {actions.length > visible ? (
            <SeoShowMore
              more={t("strategy.actions.more", {
                count: actions.length - visible,
              })}
              expanded={expanded}
              onToggle={() => setExpanded((open) => !open)}
            />
          ) : null}
        </SeoSection>
      ) : null}
      {places.length ? (
        // Communities, lists, directories and stores in one list, easiest first: each is a place to get a link.
        <SeoSection
          title={t("strategy.links.title")}
          description={t("strategy.links.help")}
        >
          <ul
            role="list"
            className={SEO_ROW_LIST_CLASS}
            data-testid="seo-strategy-places"
          >
            {(placesOpen ? places : places.slice(0, placesVisible)).map(
              (place, index) => (
                <li key={place.key}>
                  <StrategyActionCard
                    action={place.action}
                    model={model}
                    title={
                      place.task
                        ? t(`strategy.links.task.${place.task}`, {
                            site: place.name,
                          })
                        : place.name
                    }
                    page={place.page}
                    meta={
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className={cn(
                            "size-1.5 rounded-full",
                            EASE_MARK_CLASS[place.ease],
                          )}
                        />
                        {[
                          t(`strategy.links.ease.${place.ease}`),
                          place.reads
                            ? t("strategy.links.reach", place.reads)
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    }
                    note={t(`strategy.links.reason.${place.reason}`)}
                    startOpen={
                      places.length === 1 ||
                      (led && !actions.length && index === 0)
                    }
                  />
                </li>
              ),
            )}
          </ul>
          {places.length > placesVisible ? (
            <SeoShowMore
              more={t("strategy.links.more", {
                count: places.length - placesVisible,
              })}
              expanded={placesOpen}
              onToggle={() => setPlacesOpen((open) => !open)}
            />
          ) : null}
        </SeoSection>
      ) : null}
    </div>
  );
}

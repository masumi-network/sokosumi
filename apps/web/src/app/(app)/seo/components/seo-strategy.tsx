"use client";

import type { ProjectSeoStrategy } from "@sokosumi/core-client";
import { Check, Copy, WandSparkles } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { useClipboard } from "@/hooks/use-clipboard";
import { cn } from "@/lib/utils";
import {
  SeoDate,
  SeoFoldSummary,
  SeoPageLink,
  SeoSection,
  SeoSource,
  SeoState,
} from "./seo-shared";
import {
  SEO_STRATEGY_ACTION_KINDS,
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

function useStrategyLabels() {
  const t = useTranslations("App.Seo");
  return {
    verdict: (word: string) => {
      const key = seoStrategyKey(SEO_STRATEGY_VERDICTS, word);
      return key ? t(`strategy.verdict.${key}`) : word;
    },
    reach: (word: string) => {
      const key = seoStrategyKey(SEO_STRATEGY_REACHES, word);
      return key ? t(`strategy.reach.${key}`) : word;
    },
  };
}

/** The Agent card's line: the site audit's keyword result in one sentence. The Rankings tab holds its numbers. */
export function SeoStrategyLine({
  strategy,
}: {
  strategy: ProjectSeoStrategy | null | undefined;
}) {
  const t = useTranslations("App.Seo");
  const labels = useStrategyLabels();
  if (!strategy) return null;
  return (
    <p className="text-sm" data-testid="seo-agent-strategy">
      <span className="text-muted-foreground">{t("strategy.title")}: </span>
      {labels.verdict(strategy.verdict)}
    </p>
  );
}

/** The site audit's result for the keywords: the verdict, its reason and how many keyword groups the site can reach. */
export function SeoStrategyCard({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const labels = useStrategyLabels();
  const strategy = model.data.strategy;
  if (!strategy) return null;
  const reason = seoStrategyReason(strategy);
  const counts = seoStrategyCounts(strategy.groups);
  return (
    <SeoSection
      title={t("strategy.title")}
      description={
        <>
          {t("strategy.from")} <SeoDate value={strategy.observedAt} />
        </>
      }
    >
      <div className={cn(HOLDER_ITEM_CLASS, "min-w-0 space-y-2 p-4")}>
        <p
          className="text-base font-semibold text-balance"
          data-testid="seo-strategy-verdict"
        >
          {labels.verdict(strategy.verdict)}
        </p>
        <p className="max-w-prose text-sm break-words">{reason.lead}</p>
        {reason.niche ? (
          <p className="max-w-prose text-sm break-words">{reason.niche}</p>
        ) : null}
        {counts.reaches.length ? (
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {counts.reaches.map(({ reach, count }) => (
              <span key={reach}>
                <span className="font-medium tabular-nums">{count}</span>{" "}
                <span className="text-muted-foreground">
                  {labels.reach(reach)}
                </span>
              </span>
            ))}
            {counts.falling ? (
              <span className="text-muted-foreground">
                {t("strategy.falling", { count: counts.falling })}
              </span>
            ) : null}
          </p>
        ) : null}
        <details className="text-sm">
          <SeoFoldSummary className="py-2.5 font-medium">
            {t("strategy.details")}
          </SeoFoldSummary>
          <div className="text-muted-foreground max-w-prose space-y-2 pt-1">
            <p>{t("strategy.reachHelp")}</p>
            {reason.details.length ? (
              <ul className="list-disc space-y-1 ps-4">
                {reason.details.map((line, index) => (
                  <li key={`${index}:${line}`} className="break-words">
                    {line}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </details>
        <SeoSource
          observationId={strategy.observationId}
          workspace={model.data}
        />
      </div>
    </SeoSection>
  );
}

/** Under a keyword: the reach of its group, and the recent searches when they move. */
export function SeoKeywordDemand({
  group,
  keyword,
}: {
  group: SeoStrategyGroup | undefined;
  keyword: string;
}) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const labels = useStrategyLabels();
  const demand = seoKeywordDemand(group, keyword);
  if (!demand) return null;
  const parts = [
    demand.reach ? labels.reach(demand.reach) : null,
    demand.trend
      ? t(`strategy.trend.${demand.trend.direction}`, {
          recent: format.number(demand.trend.recent),
        })
      : null,
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

function StrategyActionCard({
  action,
  model,
}: {
  action: ProjectSeoStrategy["actions"][number];
  model: SeoWorkspaceModel;
}) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  // Every card has the same button name; the card's title tells them apart.
  const titleId = useId();
  const kind = seoStrategyKey(SEO_STRATEGY_ACTION_KINDS, action.kind);
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
  return (
    <article className={cn(HOLDER_ITEM_CLASS, "min-w-0 space-y-3 p-4")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={titleId} className="text-sm font-semibold break-words">
          {action.title}
        </h3>
        <div className="flex flex-wrap gap-1">
          {kind ? (
            <SeoState>{t(`strategy.actionKind.${kind}`)}</SeoState>
          ) : null}
          <SeoState>
            {t("actions.effort")}: {t(`priority.${action.effort}`)}
          </SeoState>
        </div>
      </div>
      <p className="text-muted-foreground max-w-prose text-sm break-words">
        {action.why}
      </p>
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
              keys.type ? t(`strategy.targetType.${keys.type}`) : null,
              keys.state ? t(`strategy.targetState.${keys.state}`) : null,
            ].filter((note): note is string => note !== null);
            return (
              <li
                key={`${index}:${target.url}`}
                className="flex flex-wrap items-baseline gap-x-2"
              >
                <SeoPageLink url={target.url} label={target.title} />
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
    </article>
  );
}

/**
 * The actions of the audit's keyword strategy: a listing on another site, a new page, a page with a new target,
 * a place to promote the product in.
 * None is one page edit, so none has a draft Task. The button puts a question in the chat field and sends nothing.
 */
export function SeoStrategyActions({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const actions = model.data.strategy?.actions ?? [];
  if (!actions.length) return null;
  return (
    <SeoSection
      title={t("strategy.actions.title")}
      // Without an audit the cards have no button, so the text names none.
      description={
        model.data.auditId
          ? `${t("strategy.actions.help")} ${t("strategy.actions.helpAsk")}`
          : t("strategy.actions.help")
      }
    >
      {actions.map((action, index) => (
        <StrategyActionCard
          key={`${index}:${action.title}`}
          action={action}
          model={model}
        />
      ))}
    </SeoSection>
  );
}

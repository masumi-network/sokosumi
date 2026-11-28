"use client";

import type { ProjectSeoAction } from "@sokosumi/core-client";
import { ArrowRight, Bot } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, type RefObject, useId } from "react";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { SeoField, SeoSelect } from "./seo-form-fields";
import { SeoPlanHandoff } from "./seo-plan-handoff";
import {
  type SeoPlanMessageModel,
  seoPlanExcerpt,
} from "./seo-plan-message-model";
import { SeoPlanStep } from "./seo-plan-step";
import { SeoFoldSummary } from "./seo-shared";
import type { useSelectedSeoPlan } from "./use-selected-seo-plan";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** A fold of the plan: one quiet line that opens in place. */
const FOLD_CLASS =
  "text-muted-foreground hover:text-foreground min-h-11 justify-between gap-4 py-2 text-sm font-medium";
/** A label in front of the worker's text, in the reader's language. */
const LABEL_CLASS = "text-foreground font-medium";
/**
 * The SEO worker's plan as one text: a concise TLDR, central agent handoff, numbered independent step disclosures, and
 * supporting context tucked under quiet folds. Every text of the plan is the worker's own English text and shows as
 * plain text.
 */
export function SeoPlanMessage({
  model,
  selected,
  message,
  onOpen,
  titleRef,
  pdf,
  status,
  figures,
}: {
  model: SeoWorkspaceModel;
  selected: ReturnType<typeof useSelectedSeoPlan>;
  message: SeoPlanMessageModel;
  onOpen: (action: ProjectSeoAction, button: HTMLButtonElement) => void;
  /** Focus goes to the title when the control that had it leaves the page. */
  titleRef: RefObject<HTMLHeadingElement | null>;
  /** The link to the audit's PDF. */
  pdf?: ReactNode;
  /** A check that runs, or statistics that refresh. */
  status?: ReactNode;
  /** The search numbers of the audit: each opens its tab. */
  figures?: ReactNode;
}) {
  const ui = useTranslations("App.Seo");
  const titleId = useId();
  const selector = useId();
  const { options, setPicked } = selected;
  const reportLabel =
    options.find((o) => o.value === selected.report?.id)?.label ?? "";
  const first = message.steps[0];
  const summary = seoPlanExcerpt(message.summary);
  const direction = seoPlanExcerpt(message.strategy ?? "");
  // A long narrative belongs in the overview. Lead with the recorded direction when it fits on its own.
  const useDirection = Boolean(summary.rest && direction.lead);
  const lead = useDirection ? direction.lead : summary.lead || first.action;
  const rest = useDirection ? message.summary : summary.rest;
  const remainingDirection = useDirection ? direction.rest : message.strategy;
  const hasOverview = Boolean(rest || remainingDirection || figures);
  const open = (tab: "actions" | "traffic" | "rankings") => () =>
    void model.setFilters({ tab });

  return (
    <section
      aria-labelledby={titleId}
      data-testid="seo-plan-message"
      className={cn(HOLDER_ITEM_CLASS, "content-rise min-w-0 p-5 sm:p-6")}
    >
      <header className="border-border space-y-3 border-b pb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h3
            id={titleId}
            ref={titleRef}
            tabIndex={-1}
            className="focus-visible:outline-ring rounded-sm text-lg font-semibold tracking-tight focus-visible:outline-2"
          >
            {ui("planMessage.title")}
          </h3>
          <SeoPlanHandoff
            message={message}
            reportLabel={reportLabel}
            websiteUrl={model.data.websiteUrl}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {options.length > 1 ? (
              <SeoField id={selector} label={ui("reportFiles.run")}>
                <SeoSelect
                  lang="en"
                  id={selector}
                  options={options}
                  value={selected.report?.id ?? ""}
                  onValueChange={setPicked}
                />
              </SeoField>
            ) : reportLabel ? (
              <p
                lang="en"
                className="text-muted-foreground text-xs tabular-nums"
              >
                {reportLabel}
              </p>
            ) : null}
          </div>
          {pdf ? <div className="shrink-0">{pdf}</div> : null}
        </div>
      </header>
      {status ? <div className="pt-4">{status}</div> : null}
      {/* Keyed by selected report so step disclosures and overview folds reset cleanly on report switch. */}
      <div
        key={selected.report?.id ?? "plan"}
        className="min-w-0 text-sm leading-relaxed break-words"
      >
        <div className="space-y-2 pt-5 pb-4">
          <p
            lang="en"
            className="text-foreground max-w-prose text-sm leading-relaxed sm:text-base"
          >
            {lead}
          </p>
          {hasOverview ? (
            <details className="min-w-0">
              <SeoFoldSummary className="text-muted-foreground hover:text-foreground -ms-1.5 inline-flex min-h-11 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium">
                {ui("planMessage.overview")}
              </SeoFoldSummary>
              <div className="max-w-prose space-y-4 pt-2 pb-3 text-sm leading-relaxed">
                {rest ? (
                  <p lang="en" className="text-muted-foreground">
                    {rest}
                  </p>
                ) : null}
                {remainingDirection ? (
                  <p className="border-control-border text-muted-foreground border-s-2 ps-3">
                    <span className={LABEL_CLASS}>
                      {ui("planMessage.direction")}
                    </span>{" "}
                    <span lang="en">{remainingDirection}</span>
                  </p>
                ) : null}
                {figures ? <div className="space-y-3">{figures}</div> : null}
              </div>
            </details>
          ) : null}
        </div>
        <ol
          role="list"
          aria-label={ui("planMessage.steps")}
          className="border-border border-t"
        >
          {message.steps.map((step, index) => (
            <SeoPlanStep
              key={index}
              step={step}
              index={index}
              defaultOpen={index === 0}
              workspace={model.data}
              onOpen={onOpen}
            />
          ))}
        </ol>
        {message.alternative || message.revisit ? (
          <section
            aria-label={ui("planMessage.supporting")}
            className="border-border divide-border divide-y border-b"
          >
            {message.alternative ? (
              <details>
                <SeoFoldSummary className={FOLD_CLASS}>
                  {ui("planMessage.later")}
                </SeoFoldSummary>
                <div
                  lang="en"
                  className="text-muted-foreground max-w-prose space-y-1.5 pt-1 pb-4 text-sm leading-relaxed"
                >
                  <p className={LABEL_CLASS}>{message.alternative.option}</p>
                  <p>{message.alternative.whyNot}</p>
                </div>
              </details>
            ) : null}
            {message.revisit ? (
              <details>
                <SeoFoldSummary className={FOLD_CLASS}>
                  {ui("planMessage.revisit")}
                </SeoFoldSummary>
                <p
                  lang="en"
                  className="text-muted-foreground max-w-prose pt-1 pb-4 text-sm leading-relaxed"
                >
                  {message.revisit}
                </p>
              </details>
            ) : null}
          </section>
        ) : null}
        <div className="space-y-4 pt-5">
          {/* Without an Audit there is no agent to write to. The question goes into the chat field: the reader sends it. */}
          {model.data.auditId && first ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground text-xs">
                {ui("planMessage.ask.title")}
              </span>
              {(["how", "why"] as const).map((key) => (
                <Button
                  key={key}
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    model.openChat(
                      ui(`planMessage.ask.${key}Question`, {
                        step: first.action,
                      }),
                    )
                  }
                >
                  <Bot aria-hidden />
                  {ui(`planMessage.ask.${key}`)}
                </Button>
              ))}
            </div>
          ) : null}
          <nav
            aria-label={ui("planMessage.more")}
            className="border-border flex flex-wrap gap-1 border-t pt-4"
          >
            <Button size="sm" variant="ghost" onClick={open("actions")}>
              {message.rest
                ? ui("planMessage.rest", { count: message.rest })
                : ui("tabs.actions")}
              <ArrowRight aria-hidden />
            </Button>
            {(["traffic", "rankings"] as const).map((tab) => (
              <Button key={tab} size="sm" variant="ghost" onClick={open(tab)}>
                {ui(`tabs.${tab}`)}
                <ArrowRight aria-hidden />
              </Button>
            ))}
          </nav>
        </div>
      </div>
    </section>
  );
}

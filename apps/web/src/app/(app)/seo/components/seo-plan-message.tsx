"use client";

import type { ProjectSeoAction } from "@sokosumi/core-client";
import { ArrowRight, Bot, Check, ChevronRight } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { type ReactNode, type RefObject, useId } from "react";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { cn } from "@/lib/utils";
import { SeoField, SeoSelect } from "./seo-form-fields";
import type { SeoPlanMessageModel } from "./seo-plan-message-model";
import {
  SEO_ROW_ARROW_CLASS,
  SEO_ROW_BUTTON_CLASS,
  SEO_ROW_LIST_CLASS,
  SeoActionName,
  SeoFoldSummary,
  SeoPageText,
  SeoSeverity,
} from "./seo-shared";
import type { useSelectedSeoPlan } from "./use-selected-seo-plan";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** A fold of the plan: one quiet line that opens in place. */
const FOLD_CLASS = "text-muted-foreground min-h-9 justify-between gap-4";
/** A label in front of the worker's text, in the reader's language. */
const LABEL_CLASS = "font-medium";
/** The state of a step whose actions the reader has started or finished, as the Actions tab names it. */
const STATE_KEY = { done: "implemented", started: "task_created" } as const;

/**
 * The SEO worker's plan as one text: what the audit found, the steps in their order with the reason for each and
 * for its position, and what would change the plan. A step opens the action it stands for. Every text of the plan
 * is the worker's own English text and shows as plain text.
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
  const report = useSeoResultTranslations("App.Seo");
  const format = useFormatter();
  const titleId = useId();
  const selector = useId();
  const { options, setPicked } = selected;
  const first = message.steps[0];
  const open = (tab: "actions" | "traffic" | "rankings") => () =>
    void model.setFilters({ tab });
  return (
    <section
      aria-labelledby={titleId}
      data-testid="seo-plan-message"
      className={cn(HOLDER_ITEM_CLASS, "content-rise min-w-0 space-y-4 p-4")}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3
            id={titleId}
            ref={titleRef}
            tabIndex={-1}
            className="focus-visible:outline-ring rounded-sm text-lg font-semibold focus-visible:outline-2"
          >
            {ui("planMessage.title")}
          </h3>
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
          ) : (
            <p lang="en" className="text-muted-foreground text-xs">
              {options[0]?.label}
            </p>
          )}
        </div>
        {pdf}
      </div>
      {status}
      <div className="min-w-0 space-y-4 text-sm leading-relaxed break-words">
        <p lang="en" className="max-w-prose text-base">
          {message.summary}
        </p>
        {figures}
        {message.strategy ? (
          <p className="max-w-prose">
            <span className={LABEL_CLASS}>{ui("planMessage.direction")}</span>{" "}
            <span lang="en">{message.strategy}</span>
          </p>
        ) : null}
        <ol role="list" aria-label={ui("planMessage.steps")}>
          {message.steps.map((step, index) => {
            const single = step.actions.length === 1 ? step.actions[0] : null;
            return (
              <li
                key={index}
                className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3"
              >
                {/* The rail: the number of the step and a line to the next one. */}
                <span aria-hidden className="flex flex-col items-center">
                  <span className="bg-quinary flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums">
                    {step.state === "done" ? (
                      <Check className="size-3.5" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  {index < message.steps.length - 1 ? (
                    <span className="bg-border my-1 w-px flex-1" />
                  ) : null}
                </span>
                <div className="min-w-0 space-y-2 pb-5">
                  <h4 lang="en" className="text-base font-semibold">
                    {single ? (
                      <button
                        type="button"
                        className="group/row focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm text-start underline-offset-4 outline-none hover:underline focus-visible:ring-2"
                        onClick={(event) => onOpen(single, event.currentTarget)}
                      >
                        {step.action}
                        <ChevronRight className={SEO_ROW_ARROW_CLASS} />
                      </button>
                    ) : (
                      step.action
                    )}
                  </h4>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 empty:hidden">
                    {step.kind ? (
                      <span className="bg-quinary rounded-full px-2 py-0.5 text-xs font-medium">
                        {ui(`planMessage.kinds.${step.kind}`)}
                      </span>
                    ) : null}
                    {step.severity ? (
                      <SeoSeverity severity={step.severity} />
                    ) : null}
                    {step.state === "open" ? null : (
                      <span className="text-muted-foreground text-xs">
                        {ui(`actions.${STATE_KEY[step.state]}`)}
                      </span>
                    )}
                    {step.window ? (
                      <span className="text-muted-foreground text-xs">
                        {ui("planMessage.window", {
                          month: format.dateTime(
                            new Date(`${step.window}-01T00:00:00Z`),
                            { month: "long", year: "numeric", timeZone: "UTC" },
                          ),
                        })}
                      </span>
                    ) : null}
                  </div>
                  {step.pageUrl ? (
                    <SeoPageText url={step.pageUrl} workspace={model.data} />
                  ) : null}
                  <p lang="en" className="max-w-prose">
                    {step.why}
                  </p>
                  {step.order ? (
                    <p className="max-w-prose">
                      <span className={LABEL_CLASS}>
                        {ui("planMessage.order")}
                      </span>{" "}
                      <span lang="en" className="text-muted-foreground">
                        {step.order}
                      </span>
                    </p>
                  ) : null}
                  {step.queries?.length ? (
                    <p lang="en" className="text-muted-foreground max-w-prose">
                      {report("reportPlan.queries", {
                        queries: step.queries.join(", "),
                      })}
                    </p>
                  ) : null}
                  {step.ideas?.length ? (
                    <div className="max-w-prose space-y-1">
                      <p className={LABEL_CLASS}>{ui("planMessage.ideas")}</p>
                      <ul
                        lang="en"
                        className="text-muted-foreground list-disc space-y-1 ps-5"
                      >
                        {step.ideas.map((idea, at) => (
                          <li key={at}>{idea}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {step.wording ? (
                    <div className="max-w-prose space-y-1">
                      <p className={LABEL_CLASS}>{ui("planMessage.wording")}</p>
                      <blockquote
                        lang="en"
                        className="text-muted-foreground border-s-2 ps-3"
                      >
                        {step.wording}
                      </blockquote>
                    </div>
                  ) : null}
                  <details>
                    <SeoFoldSummary className={FOLD_CLASS}>
                      {ui("planMessage.check")}
                    </SeoFoldSummary>
                    <p lang="en" className="max-w-prose pt-1 pb-2">
                      {step.nextCheck}
                    </p>
                  </details>
                  {step.actions.length > 1 ? (
                    <ul
                      role="list"
                      aria-label={ui("planMessage.stepActions")}
                      className={SEO_ROW_LIST_CLASS}
                    >
                      {step.actions.map((action) => (
                        <li key={action.id}>
                          <button
                            type="button"
                            lang="en"
                            className={cn(SEO_ROW_BUTTON_CLASS, "px-3 py-2")}
                            onClick={(event) =>
                              onOpen(action, event.currentTarget)
                            }
                          >
                            <SeoActionName
                              title={action.title}
                              pageUrl={action.pageUrl}
                              workspace={model.data}
                            />
                            <ChevronRight className={SEO_ROW_ARROW_CLASS} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
        {message.alternative || message.revisit ? (
          <div className="divide-y border-t">
            {message.alternative ? (
              <details>
                <SeoFoldSummary className={FOLD_CLASS}>
                  {ui("planMessage.later")}
                </SeoFoldSummary>
                <div lang="en" className="max-w-prose space-y-1 pt-1 pb-3">
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
                <p lang="en" className="max-w-prose pt-1 pb-3">
                  {message.revisit}
                </p>
              </details>
            ) : null}
          </div>
        ) : null}
        {/* Without an Audit there is no agent to write to. The question goes into the chat field: the reader sends it. */}
        {model.data.auditId ? (
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
          className="flex flex-wrap gap-1 border-t pt-3"
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
    </section>
  );
}

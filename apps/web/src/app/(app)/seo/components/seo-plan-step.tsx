"use client";

import type {
  ProjectSeoAction,
  ProjectSeoWorkspace,
} from "@sokosumi/core-client";
import { ArrowRight, Check, ChevronDown, ChevronRight } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { cn } from "@/lib/utils";
import {
  type SeoPlanMessageModel,
  seoPlanExcerpt,
} from "./seo-plan-message-model";
import {
  SEO_ROW_ARROW_CLASS,
  SEO_ROW_BUTTON_CLASS,
  SEO_ROW_LIST_CLASS,
  SeoActionName,
  SeoFoldSummary,
  SeoPageText,
  SeoSeverity,
} from "./seo-shared";

/** The state of a step whose actions the reader has started or finished, as the Actions tab names it. */
const STATE_KEY = { done: "implemented", started: "task_created" } as const;
/** A secondary disclosure inside an expanded step. */
const NESTED_FOLD_CLASS =
  "text-muted-foreground hover:text-foreground min-h-11 justify-between gap-4 py-2 text-xs font-medium";

type SeoPlanStepItem = SeoPlanMessageModel["steps"][number];

/**
 * One numbered step of the written SEO plan as an independent native disclosure.
 * The summary toggles the step; action details open from distinct controls inside the expanded body.
 */
export function SeoPlanStep({
  step,
  index,
  defaultOpen,
  workspace,
  onOpen,
}: {
  step: SeoPlanStepItem;
  index: number;
  defaultOpen: boolean;
  workspace: ProjectSeoWorkspace;
  onOpen: (action: ProjectSeoAction, button: HTMLButtonElement) => void;
}) {
  const ui = useTranslations("App.Seo");
  const report = useSeoResultTranslations("App.Seo");
  const format = useFormatter();
  const single = step.actions.length === 1 ? step.actions[0] : null;
  const reason = seoPlanExcerpt(step.why);
  const hasOptionalDetails = Boolean(
    reason.rest ||
      step.order ||
      step.wording ||
      step.queries?.length ||
      step.ideas?.length ||
      step.window,
  );
  const hasDetailsFold = Boolean(step.nextCheck || hasOptionalDetails);

  return (
    <li className="border-border border-b">
      <details className="group min-w-0" open={defaultOpen}>
        <summary className="hover:bg-quinary focus-visible:ring-ring -mx-2 grid min-h-13 cursor-pointer list-none grid-cols-[1.5rem_minmax(0,1fr)_auto] items-start gap-3 rounded-md px-2 py-3.5 transition-colors outline-none focus-visible:ring-2 [&::-webkit-details-marker]:hidden">
          <span
            aria-hidden
            className="text-muted-foreground group-open:text-foreground pt-0.5 text-sm font-semibold tabular-nums"
          >
            {step.state === "done" ? <Check className="size-4" /> : index + 1}
          </span>
          <span className="min-w-0 space-y-1">
            <h4
              lang="en"
              className="text-foreground text-sm leading-snug font-semibold break-words sm:text-base"
            >
              {step.action}
            </h4>
            <span className="text-muted-foreground flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs empty:hidden">
              {step.kind ? (
                <span>{ui(`planMessage.kinds.${step.kind}`)}</span>
              ) : null}
              {step.severity ? <SeoSeverity severity={step.severity} /> : null}
              {step.state === "open" ? null : (
                <span>{ui(`actions.${STATE_KEY[step.state]}`)}</span>
              )}
              {step.pageUrl ? (
                <SeoPageText url={step.pageUrl} workspace={workspace} />
              ) : null}
            </span>
          </span>
          <ChevronDown
            aria-hidden
            className="text-muted-foreground group-open:text-foreground mt-1 size-4 shrink-0 transition-transform duration-150 ease-out motion-reduce:transition-none group-open:rotate-180"
          />
        </summary>
        <div className="space-y-4 ps-9 pe-1 pt-1 pb-6 text-sm leading-relaxed break-words">
          {reason.lead && (
            <p lang="en" className="text-foreground max-w-prose">
              {reason.lead}
            </p>
          )}
          {hasDetailsFold ? (
            <details className="border-border max-w-prose border-t">
              <SeoFoldSummary className={NESTED_FOLD_CLASS}>
                {hasOptionalDetails
                  ? ui("planMessage.stepDetails")
                  : ui("planMessage.check")}
              </SeoFoldSummary>
              <div className="text-muted-foreground space-y-3 pt-1 pb-3 text-sm leading-relaxed">
                {reason.rest && <p lang="en">{reason.rest}</p>}
                {step.order ? (
                  <p className="text-muted-foreground max-w-prose">
                    <span className="text-foreground font-medium">
                      {ui("planMessage.order")}
                    </span>{" "}
                    <span lang="en">{step.order}</span>
                  </p>
                ) : null}
                {step.wording ? (
                  <div className="space-y-1.5">
                    <p className="text-foreground text-xs font-medium">
                      {ui("planMessage.wording")}
                    </p>
                    <blockquote
                      lang="en"
                      className="border-control-border text-foreground border-s-2 ps-3"
                    >
                      {step.wording}
                    </blockquote>
                  </div>
                ) : null}
                {step.queries?.length ? (
                  <p lang="en">
                    {report("reportPlan.queries", {
                      queries: step.queries.join(", "),
                    })}
                  </p>
                ) : null}
                {step.ideas?.length ? (
                  <div className="space-y-1.5">
                    <p className="text-foreground text-xs font-medium">
                      {ui("planMessage.ideas")}
                    </p>
                    <ul lang="en" className="list-disc space-y-1 ps-5">
                      {step.ideas.map((idea, at) => (
                        <li key={at}>{idea}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {step.window ? (
                  <p className="text-xs">
                    {ui("planMessage.window", {
                      month: format.dateTime(
                        new Date(`${step.window}-01T00:00:00Z`),
                        { month: "long", year: "numeric", timeZone: "UTC" },
                      ),
                    })}
                  </p>
                ) : null}
                {step.nextCheck ? (
                  hasOptionalDetails ? (
                    <div className="space-y-1">
                      <p className="text-foreground text-xs font-medium">
                        {ui("planMessage.check")}
                      </p>
                      <p lang="en">{step.nextCheck}</p>
                    </div>
                  ) : (
                    <p lang="en">{step.nextCheck}</p>
                  )
                ) : null}
              </div>
            </details>
          ) : null}
          {single ? (
            <div className="pt-1">
              <Button
                size="sm"
                variant="outline"
                onClick={(event) => onOpen(single, event.currentTarget)}
              >
                {ui("reportPlan.open")}
                <ArrowRight aria-hidden />
              </Button>
            </div>
          ) : step.actions.length > 1 ? (
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
                    className={cn(SEO_ROW_BUTTON_CLASS, "px-3 py-2.5")}
                    onClick={(event) => onOpen(action, event.currentTarget)}
                  >
                    <SeoActionName
                      title={action.title}
                      pageUrl={action.pageUrl}
                      workspace={workspace}
                    />
                    <ChevronRight className={SEO_ROW_ARROW_CLASS} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </details>
    </li>
  );
}

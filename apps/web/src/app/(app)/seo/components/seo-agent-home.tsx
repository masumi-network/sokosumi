"use client";

import { Bot } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { SeoActionCard } from "./seo-actions";
import { type SeoAgentStep, seoAgentBrief } from "./seo-agent-model";
import { SeoChatThread, useSeoChatIdentity } from "./seo-chat-panel";
import { SeoConnectionButton } from "./seo-connection-button";
import { SeoGettingStarted } from "./seo-getting-started";
import { SeoDate, SeoPeriod } from "./seo-shared";
import { useSeoAutopilot } from "./use-seo-autopilot";
import { useSeoChat } from "./use-seo-chat";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export const SEO_AGENT_INPUT_ID = "seo-agent-question";

function StepRow({
  step,
  model,
  refresh,
  refreshing,
}: {
  step: Exclude<SeoAgentStep, { kind: "action" }>;
  model: SeoWorkspaceModel;
  refresh: () => void;
  refreshing: boolean;
}) {
  const t = useTranslations("App.Seo");
  const { canEdit, canRequestAnalysis } = model.data.availableActions;
  const [body, control] =
    step.kind === "refresh"
      ? [
          t(`agent.steps.refresh.${step.reason}`),
          <Button
            key="refresh"
            size="sm"
            variant="outline"
            loading={refreshing}
            onClick={refresh}
          >
            {t("queries.refresh")}
          </Button>,
        ]
      : step.kind === "connect"
        ? [
            t(`agent.steps.connect.${step.provider}`),
            <SeoConnectionButton
              key="connect"
              provider={step.provider}
              onConnected={() => model.openStatistics(step.provider)}
            />,
          ]
        : [
            t(
              step.available
                ? "agent.steps.competitors.available"
                : "agent.steps.competitors.unavailable",
            ),
            canEdit && (canRequestAnalysis || !step.available) ? (
              <Button
                key="competitors"
                size="sm"
                variant="outline"
                onClick={() =>
                  model.setDialog(step.available ? "analysis" : "competitor")
                }
              >
                {t(
                  step.available
                    ? "agent.researchCompetitors"
                    : "competitors.add",
                )}
              </Button>
            ) : null,
          ];
  return (
    <li
      className={cn(
        HOLDER_ITEM_CLASS,
        "flex flex-wrap items-center justify-between gap-3 p-4",
      )}
    >
      <p className="min-w-0 flex-1 text-sm">{body}</p>
      {control}
    </li>
  );
}

function AgentConversation({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  // History waits for a fresh Audit read, so a revoked or missing Audit is never read again.
  const chat = useSeoChat(
    model,
    model.result.isFetchedAfterMount && model.result.isSuccess,
  );
  return (
    <div className={cn(HOLDER_ITEM_CLASS, "flex min-h-96 min-w-0 flex-col")}>
      <div className="border-b px-4 py-3">
        <h3 className="text-sm font-semibold">{t("chat.title")}</h3>
        <p className="text-muted-foreground text-xs">{t("chat.description")}</p>
      </div>
      <SeoChatThread
        model={model}
        chat={chat}
        inputId={SEO_AGENT_INPUT_ID}
        className="max-h-[48rem] flex-1"
      />
    </div>
  );
}

/** The SEO agent is the first thing on an Audit: what it knows, what it proposes, and the conversation. */
export function SeoAgentHome({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const [now] = useState(() => new Date());
  const brief = seoAgentBrief(model.data, now);
  const autopilot = useSeoAutopilot(model, brief);
  const identity = useSeoChatIdentity(model);
  const count = (value: number | null) =>
    value === null ? t("none") : format.number(value);
  return (
    <section
      aria-labelledby="seo-agent-title"
      className={cn(
        HOLDER_CLASS,
        "grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]",
      )}
    >
      <div className="min-w-0 space-y-3">
        <div className="flex items-start gap-3 px-2 pt-1">
          <Bot className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div>
            <h2 id="seo-agent-title" className="text-base font-semibold">
              {t("agent.title")}
            </h2>
            <p className="text-muted-foreground text-sm">
              {t("agent.subtitle")}
            </p>
          </div>
        </div>
        <div className={cn(HOLDER_ITEM_CLASS, "space-y-3 p-4")}>
          <h3 className="text-sm font-semibold">{t("agent.knownTitle")}</h3>
          <ul className="space-y-2 text-sm">
            <li>
              {brief.lastCheck ? (
                <>
                  {t("agent.lastCheck", {
                    checked: brief.lastCheck.checked,
                    pages: brief.lastCheck.pages,
                  })}{" "}
                  <span className="text-muted-foreground">
                    (<SeoDate value={brief.lastCheck.at} />)
                  </span>
                </>
              ) : (
                t("agent.noCheck")
              )}
            </li>
            {brief.lastCheck ? (
              <li>
                {brief.issues
                  ? t("agent.issues", { count: brief.issues })
                  : t("agent.noIssues")}
              </li>
            ) : null}
            <li>
              {brief.search ? (
                <>
                  {t("agent.search", {
                    clicks: count(brief.search.clicks),
                    impressions: count(brief.search.impressions),
                  })}{" "}
                  <span className="text-muted-foreground">
                    (
                    <SeoPeriod from={brief.search.from} to={brief.search.to} />)
                  </span>
                </>
              ) : (
                t("agent.noSearch")
              )}
            </li>
            {brief.search ? (
              <li>
                {brief.search.queries === null
                  ? t("agent.queriesMissing")
                  : t("agent.queries", { count: brief.search.queries })}
              </li>
            ) : null}
            <li>
              {t("agent.suggestions", {
                fixes: brief.fixes,
                opportunities: brief.opportunities,
              })}
            </li>
          </ul>
          {autopilot.state === "refreshing" ? (
            <p role="status" className="text-muted-foreground text-sm">
              {t("agent.refreshing")}
            </p>
          ) : autopilot.state === "failed" ? (
            <p role="alert" className="text-destructive text-sm">
              {t("agent.refreshFailed")}
            </p>
          ) : null}
          {model.data.availableActions.canSyncMetrics ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => model.setDialog("statistics")}
            >
              {t("overview.manageConnections")}
            </Button>
          ) : null}
        </div>
        <div className="space-y-2">
          <h3 className="px-2 text-sm font-semibold">{t("agent.nextTitle")}</h3>
          {!model.data.observations.length ? (
            <SeoGettingStarted model={model} />
          ) : null}
          {brief.steps.length ? (
            <ul className="space-y-2">
              {brief.steps.map((step) =>
                step.kind === "action" ? (
                  <li key={`${step.action.observationId}:${step.action.id}`}>
                    <SeoActionCard action={step.action} model={model} />
                  </li>
                ) : (
                  <StepRow
                    key={`${step.kind}:${"provider" in step ? step.provider : ""}`}
                    step={step}
                    model={model}
                    refresh={() => {
                      void autopilot.refresh();
                    }}
                    refreshing={autopilot.state === "refreshing"}
                  />
                ),
              )}
            </ul>
          ) : (
            <p className="text-muted-foreground px-2 text-sm">
              {t("agent.nothingNext")}
            </p>
          )}
        </div>
      </div>
      {model.data.auditId ? (
        <AgentConversation key={identity} model={model} />
      ) : null}
    </section>
  );
}

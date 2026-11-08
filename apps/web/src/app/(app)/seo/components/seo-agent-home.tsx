"use client";

import { Bot } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { SeoActionCard } from "./seo-actions";
import {
  type SeoAgentBrief,
  type SeoAgentStep,
  seoAgentBrief,
} from "./seo-agent-model";
import { SeoChatThread, useSeoChatIdentity } from "./seo-chat-panel";
import { SeoConnectionButton } from "./seo-connection-button";
import { SeoGettingStarted } from "./seo-getting-started";
import { SeoDate } from "./seo-shared";
import { useSeoAutopilot } from "./use-seo-autopilot";
import { useSeoChat } from "./use-seo-chat";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export const SEO_AGENT_INPUT_ID = "seo-agent-question";

type Chat = ReturnType<typeof useSeoChat>;

function StepRow({
  step,
  model,
  chat,
  refresh,
  refreshing,
  first,
}: {
  step: Exclude<SeoAgentStep, { kind: "action" }>;
  model: SeoWorkspaceModel;
  chat: Chat;
  refresh: () => void;
  refreshing: boolean;
  /** The agent's top proposal carries the one primary button. */
  first: boolean;
}) {
  const t = useTranslations("App.Seo");
  const { canEdit, canRequestAnalysis } = model.data.availableActions;
  const variant = first ? "primary" : "outline";
  const [body, control] =
    step.kind === "keyword"
      ? [
          t("agent.steps.keyword", { keyword: step.keyword }),
          model.data.auditId ? (
            <Button
              key="keyword"
              size="sm"
              variant={variant}
              disabled={chat.busy}
              onClick={() => {
                void chat.send(
                  t("agent.prompts.keyword", { keyword: step.keyword }),
                );
              }}
            >
              {t("agent.askHow")}
            </Button>
          ) : null,
        ]
      : step.kind === "pages"
        ? [
            t("agent.steps.pages"),
            <Button
              key="pages"
              size="sm"
              variant={variant}
              onClick={() => model.setDialog("page")}
            >
              {t("addPage")}
            </Button>,
          ]
        : step.kind === "refresh"
          ? [
              t(`agent.steps.refresh.${step.reason}`),
              <Button
                key="refresh"
                size="sm"
                variant={variant}
                loading={refreshing}
                disabled={model.pending}
                onClick={refresh}
              >
                {t("syncNow")}
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
                    variant={variant}
                    onClick={() =>
                      model.setDialog(
                        step.available ? "analysis" : "competitor",
                      )
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
        "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 p-4",
      )}
    >
      <p className="min-w-0 basis-full text-sm sm:basis-0 sm:flex-1">{body}</p>
      {control}
    </li>
  );
}

function AgentConversation({
  model,
  chat,
}: {
  model: SeoWorkspaceModel;
  chat: Chat;
}) {
  const t = useTranslations("App.Seo");
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
        latestOnly
        className="max-h-[40rem] flex-1"
      />
    </div>
  );
}

/** The SEO agent is the first thing on an Audit: what it knows, what it proposes, and the conversation. */
export function SeoAgentHome({ model }: { model: SeoWorkspaceModel }) {
  const [now] = useState(() => new Date());
  const brief = seoAgentBrief(model.data, now);
  // Upkeep lives outside the keyed panel, so a session that finishes loading does not restart it.
  const autopilot = useSeoAutopilot(model, brief);
  // Keyed by viewer and Audit, so a changed account never shows a stale conversation.
  const identity = useSeoChatIdentity(model);
  return (
    <SeoAgentPanel
      key={identity}
      model={model}
      brief={brief}
      autopilot={autopilot}
    />
  );
}

function SeoAgentPanel({
  model,
  brief,
  autopilot,
}: {
  model: SeoWorkspaceModel;
  brief: SeoAgentBrief;
  autopilot: ReturnType<typeof useSeoAutopilot>;
}) {
  const t = useTranslations("App.Seo");
  // "No issues" holds only for the newest check, and only if it measured something.
  const lastCheckMeasured = (brief.lastCheck?.checked ?? 0) > 0;
  // The first proposal with its own button carries the one primary action.
  // Action cards and connection buttons keep their own style.
  const { canEdit, canRequestAnalysis } = model.data.availableActions;
  const primary = brief.steps.findIndex((step) =>
    step.kind === "keyword"
      ? Boolean(model.data.auditId)
      : step.kind === "competitors"
        ? canEdit && (canRequestAnalysis || !step.available)
        : step.kind !== "action" && step.kind !== "connect",
  );
  // History waits for a fresh Audit read, so a revoked or missing Audit is never read again.
  const chat = useSeoChat(
    model,
    model.result.isFetchedAfterMount && model.result.isSuccess,
  );
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
        <div className={cn(HOLDER_ITEM_CLASS, "space-y-2 p-4")}>
          <p className="text-lg font-semibold" data-testid="seo-agent-verdict">
            {brief.issues
              ? t("agent.verdict.issues", { count: brief.issues })
              : brief.fixes
                ? t("agent.verdict.fixes", { count: brief.fixes })
                : brief.opportunities
                  ? t("agent.verdict.waiting", { count: brief.opportunities })
                  : brief.emptyState === "no_fixes" && lastCheckMeasured
                    ? t("agent.verdict.clear")
                    : brief.lastCheck
                      ? t("actions.checksIncomplete")
                      : t("agent.verdict.noCheck")}
          </p>
          {brief.lastCheck ? (
            <p className="text-muted-foreground text-sm">
              {t("agent.lastCheckOn")} <SeoDate value={brief.lastCheck.at} />
              {" · "}
              {t("agent.lastCheck", {
                checked: brief.lastCheck.checked,
                pages: brief.lastCheck.pages,
              })}
              {brief.emptyState === "no_fixes" && lastCheckMeasured
                ? ` ${t("agent.checkScope")}`
                : null}
            </p>
          ) : null}
          {autopilot.state === "refreshing" ? (
            <p role="status" className="text-muted-foreground text-sm">
              {t("agent.refreshing")}
            </p>
          ) : autopilot.state === "failed" ? (
            <p role="alert" className="text-destructive text-sm">
              {t("agent.refreshFailed")}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <h3 className="px-2 text-sm font-semibold">{t("agent.nextTitle")}</h3>
          {!model.data.observations.length ? (
            <SeoGettingStarted model={model} />
          ) : null}
          {brief.steps.length ? (
            <ul className="space-y-2">
              {brief.steps.map((step, index) =>
                step.kind === "action" ? (
                  <li key={`${step.action.observationId}:${step.action.id}`}>
                    <SeoActionCard
                      action={step.action}
                      model={model}
                      showKind
                    />
                  </li>
                ) : (
                  <StepRow
                    key={`${step.kind}:${"provider" in step ? step.provider : ""}`}
                    step={step}
                    model={model}
                    chat={chat}
                    first={index === primary}
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
        <AgentConversation model={model} chat={chat} />
      ) : null}
    </section>
  );
}

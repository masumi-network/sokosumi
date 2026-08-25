"use client";

import { ChevronRight, ListTree } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import Markdown from "@/components/markdown";
import { formatTokens, formatUsd } from "@/components/soko-bot/format";
import type { ChatToolCall, ChatTurnDetail } from "@/lib/soko-bot/chat-state";
import { cn } from "@/lib/utils";

import { useToolLabel } from "./turn-progress";

type ChainItem =
  | { kind: "said"; text: string; interim: boolean; key: string }
  | { kind: "reasoned"; text: string; key: string }
  | {
      kind: "called";
      toolName: string | null;
      input: string | null;
      call: ChatToolCall | null;
      key: string;
    };

function readString(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "string" ? value : null;
}

/**
 * Fold the raw event stream into the few things a person wants to read:
 * what the model said between steps, what it reasoned (when the provider
 * exposes it), and each tool it called with its input and Core's result.
 */
function buildChain(turn: ChatTurnDetail): ChainItem[] {
  const calls = [...turn.toolCalls];
  const items: ChainItem[] = [];
  for (const event of turn.events) {
    if (event.type === "message.completed" && event.summary) {
      const finishReason = readString(event.payload, "finishReason");
      items.push({
        kind: "said",
        text: event.summary,
        interim: finishReason === "tool-calls",
        key: event.id,
      });
    } else if (
      event.type === "reasoning.completed" &&
      event.summary &&
      event.summary !== "Reasoning update"
    ) {
      items.push({ kind: "reasoned", text: event.summary, key: event.id });
    } else if (event.type === "actions.requested") {
      const index = calls.findIndex(
        (call) => call.capability === event.toolName,
      );
      const call = index >= 0 ? (calls.splice(index, 1)[0] ?? null) : null;
      items.push({
        kind: "called",
        toolName: event.toolName,
        input: readString(event.payload, "input"),
        call,
        key: event.id,
      });
    }
  }
  // The final answer is rendered above the disclosure; drop its duplicate.
  const last = items.at(-1);
  if (last?.kind === "said" && !last.interim && turn.finalAnswer) items.pop();
  return items;
}

/** Tool inputs are stored as JSON text; show them as readable key: value lines. */
function prettyInput(input: string): string {
  try {
    const value = JSON.parse(input) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.entries(value as Record<string, unknown>)
        .map(
          ([key, entry]) =>
            `${key}: ${typeof entry === "string" ? entry : JSON.stringify(entry)}`,
        )
        .join("\n");
    }
    return JSON.stringify(value, null, 2);
  } catch {
    return input;
  }
}

function summarizeResult(call: ChatToolCall): string | null {
  if (call.errorKind)
    return `${call.errorKind}${call.errorDetail ? `: ${call.errorDetail}` : ""}`;
  const result = call.result;
  if (result === null || result === undefined) return null;
  if (typeof result === "string") return result;
  if (typeof result !== "object") return String(result);
  const record = result as Record<string, unknown>;
  if (record.approvalRequired) return "approval requested";
  if (Array.isArray(result)) return `${result.length} results`;
  const name = readString(record, "name");
  const status = readString(record, "status");
  const id = readString(record, "id");
  if (name || status)
    return [name, status ? `(${status})` : null].filter(Boolean).join(" ");
  if (id) return id;
  const json = JSON.stringify(result);
  return json.length > 160 ? `${json.slice(0, 159)}…` : json;
}

function ChainRow({
  label,
  tone,
  children,
}: {
  label: string;
  tone: "muted" | "accent";
  children: React.ReactNode;
}) {
  return (
    <li className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 py-1.5">
      <span
        className={cn(
          "text-xs font-medium",
          tone === "accent" ? "text-primary" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      <div className="text-foreground min-w-0 text-sm leading-relaxed">
        {children}
      </div>
    </li>
  );
}

function pretty(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Collapsed raw payload, for the exact data behind a step. */
function Raw({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  const text = pretty(value);
  if (!text) return null;
  const size =
    text.length > 1024
      ? `${Math.round(text.length / 1024)} KB`
      : `${text.length} B`;
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[0.6875rem] font-medium"
      >
        <ChevronRight
          aria-hidden
          className={cn("size-3 transition-transform", open && "rotate-90")}
        />
        {label}
        <span className="text-muted-foreground/60 tabular-nums">· {size}</span>
      </button>
      {open ? (
        <pre className="bg-muted/40 text-foreground mt-1 max-h-96 overflow-auto rounded-md p-2 font-mono text-[0.6875rem] leading-snug whitespace-pre-wrap break-words">
          {text}
        </pre>
      ) : null}
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 py-1.5">
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      <div className="text-foreground min-w-0 text-sm">{children}</div>
    </div>
  );
}

function Explanation({ turn }: { turn: ChatTurnDetail }) {
  const t = useTranslations("App.SokoBot.Chat.explain");
  const tRoute = useTranslations("Components.SokoBot.Route");
  const toolLabel = useToolLabel();
  const c = turn.classification;
  const confidence =
    typeof c?.confidence === "number" ? Math.round(c.confidence * 100) : null;
  const rationale = readString(c, "rationaleSummary");
  const chain = buildChain(turn);
  const ctx = turn.contextSummary;

  return (
    <div className="border-border/60 mt-2 divide-y rounded-lg border">
      <div className="px-4 py-2">
        <Row label={t("classified")}>
          <span className="font-medium">
            {turn.route ? tRoute(turn.route) : tRoute("UNCLASSIFIED")}
          </span>
          {confidence !== null ? (
            <span className="text-muted-foreground ml-2 text-xs tabular-nums">
              {t("confidence", { percent: confidence })}
            </span>
          ) : null}
          {rationale ? (
            <p className="text-muted-foreground mt-0.5 text-xs">{rationale}</p>
          ) : null}
          <p className="text-muted-foreground mt-0.5 text-xs">
            {turn.classificationFailed
              ? t("classifierFailed")
              : turn.classifierModel
                ? t("classifier", {
                    model: turn.classifierModel,
                    ms: turn.classifierLatencyMs ?? 0,
                  })
                : t("classifierFallback")}
          </p>
        </Row>
        {ctx ? (
          <Row label={t("context")}>
            <span className="text-muted-foreground text-xs">
              {t("contextLine", {
                projects: ctx.projects,
                tasks: ctx.tasks,
                coworkers: ctx.coworkers,
                agents: ctx.agents,
                jobs: ctx.jobs,
                memory: ctx.memoryVersion,
                kb: Math.round(ctx.bytes / 1024),
              })}
            </span>
          </Row>
        ) : null}
        <Row label={t("request")}>
          <p className="text-muted-foreground text-xs">
            {t("requestLine", {
              model: turn.modelId ?? "—",
              preset: turn.presetId ?? "—",
              tools: turn.capabilityNames.length,
            })}
          </p>
          <Raw label={t("rawMessage")} value={turn.userMessage} />
          <Raw label={t("rawPacket")} value={turn.contextPacket} />
        </Row>
        <Row label={t("tools")}>
          <div className="flex flex-wrap gap-1">
            {turn.capabilityNames.map((name) => (
              <span
                key={name}
                className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs"
              >
                {toolLabel(name)}
              </span>
            ))}
          </div>
        </Row>
      </div>

      <div className="px-4 py-2">
        <p className="text-muted-foreground py-1.5 text-xs font-medium uppercase tracking-wide">
          {t("chain")}
        </p>
        {chain.length === 0 ? (
          <p className="text-muted-foreground pb-2 text-sm">{t("noChain")}</p>
        ) : (
          <ol className="divide-border/40 divide-y">
            {chain.map((item) => {
              if (item.kind === "said") {
                return (
                  <ChainRow key={item.key} label={t("said")} tone="muted">
                    <Markdown className="prose prose-sm dark:prose-invert max-w-none text-sm">
                      {item.text}
                    </Markdown>
                  </ChainRow>
                );
              }
              if (item.kind === "reasoned") {
                return (
                  <ChainRow key={item.key} label={t("reasoned")} tone="muted">
                    <span className="text-muted-foreground whitespace-pre-wrap italic">
                      {item.text}
                    </span>
                  </ChainRow>
                );
              }
              const result = item.call ? summarizeResult(item.call) : null;
              const failed = item.call?.status === "FAILED";
              return (
                <ChainRow key={item.key} label={t("called")} tone="accent">
                  <span className="font-medium">
                    {toolLabel(item.toolName)}
                  </span>
                  {item.input ? (
                    <pre className="text-muted-foreground mt-1 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs">
                      {prettyInput(item.input)}
                    </pre>
                  ) : null}
                  {result ? (
                    <p
                      className={cn(
                        "mt-1 text-xs",
                        failed
                          ? "text-semantic-destructive"
                          : "text-muted-foreground",
                      )}
                    >
                      {failed ? t("failed") : t("result")}: {result}
                    </p>
                  ) : null}
                  <Raw
                    label={t("rawInput")}
                    value={item.call?.input ?? item.input}
                  />
                  <Raw
                    label={t("rawResult")}
                    value={
                      item.call?.errorDetail
                        ? {
                            errorKind: item.call.errorKind,
                            errorDetail: item.call.errorDetail,
                          }
                        : item.call?.result
                    }
                  />
                </ChainRow>
              );
            })}
          </ol>
        )}
      </div>

      <div className="px-4 py-2">
        <Raw
          label={t("rawEvents", { count: turn.events.length })}
          value={turn.events.map((event) => ({
            sequence: event.sequence,
            type: event.type,
            at: event.createdAt,
            summary: event.summary,
            toolName: event.toolName,
            toolStatus: event.toolStatus,
            durationMs: event.durationMs,
            payload: event.payload,
          }))}
        />
      </div>

      <div className="px-4 py-2">
        <Row label={t("usage")}>
          <span className="text-muted-foreground text-xs tabular-nums">
            {t("usageLine", {
              model: turn.modelId ?? "—",
              input: formatTokens(turn.usage?.inputTokens) ?? "0",
              output: formatTokens(turn.usage?.outputTokens) ?? "0",
              cost: formatUsd(turn.usage?.costUsd) ?? "$0.00",
              seconds: Math.round((turn.durationMs ?? 0) / 1000),
            })}
          </span>
        </Row>
      </div>
    </div>
  );
}

/**
 * "Explain this turn": classification, supplied context, allowed tools, the
 * said/called chain, and cost. Loaded on demand so the activity list stays
 * light.
 */
export function TurnExplain({
  turnId,
  stepCount,
}: {
  turnId: string;
  stepCount: number;
}) {
  const t = useTranslations("App.SokoBot.Chat.explain");
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ChatTurnDetail | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open || detail) return;
    let cancelled = false;
    fetch(`/api/personal-assistant/turns/${encodeURIComponent(turnId)}`, {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        const body = (await response.json()) as { turn: ChatTurnDetail };
        if (!cancelled) setDetail(body.turn);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, detail, turnId]);

  return (
    <div className="pr-10">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-primary/40 inline-flex items-center gap-1 rounded text-xs font-medium transition-colors outline-none focus-visible:ring-2"
      >
        <ListTree aria-hidden className="size-3" />
        {open ? t("hide") : t("toggle")}
        {!open && stepCount > 0 ? (
          <span className="text-muted-foreground/70 tabular-nums">
            · {stepCount}
          </span>
        ) : null}
        <ChevronRight
          aria-hidden
          className={cn("size-3 transition-transform", open && "rotate-90")}
        />
      </button>
      {open ? (
        error ? (
          <p className="text-semantic-destructive mt-2 text-xs">{t("error")}</p>
        ) : detail ? (
          <Explanation turn={detail} />
        ) : (
          <p className="text-muted-foreground mt-2 text-xs">{t("loading")}</p>
        )
      ) : null}
    </div>
  );
}

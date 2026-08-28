import { getFormatter, getTranslations } from "next-intl/server";
import {
  formatDurationMs,
  formatTokens,
  formatUsd,
  pickSafeClassification,
  shortId,
} from "@/components/soko-bot/format";
import { MetaGrid } from "@/components/soko-bot/meta-grid";
import { Panel } from "@/components/soko-bot/panel";
import {
  TurnRouteBadge,
  TurnStatusBadge,
} from "@/components/soko-bot/soko-bot-badges";
import { TurnActivity } from "@/components/soko-bot/turn-activity";
import { TurnQuality } from "@/components/soko-bot/turn-quality";
import type { AdminSokoBotTurn } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/utils/format-bytes";

interface AdminTurnsPanelProps {
  turns: AdminSokoBotTurn[];
}

function jsonPreview(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
}

/**
 * Per-turn diagnostics: classification (safe summary only), capabilities,
 * Context snapshot metadata, Core-projected events, tool calls, delegations,
 * decisions. Model reasoning is never available here by design.
 */
export async function AdminTurnsPanel({ turns }: AdminTurnsPanelProps) {
  const [t, format] = await Promise.all([
    getTranslations("App.Admin.SokoBots.Turns"),
    getFormatter(),
  ]);
  const dateTime = (date: Date | null | undefined) =>
    date
      ? format.dateTime(date, { dateStyle: "medium", timeStyle: "medium" })
      : null;
  const yesNo = (value: boolean | null) =>
    value === null ? null : value ? t("yes") : t("no");

  return (
    <Panel
      id="turns"
      title={t("title")}
      description={t("description")}
      aside={
        <span className="text-muted-foreground text-xs tabular-nums">
          {t("count", { count: turns.length })}
        </span>
      }
      flush
    >
      {turns.length === 0 ? (
        <p className="text-muted-foreground px-4 py-6 text-sm">{t("empty")}</p>
      ) : (
        <ol className="divide-y">
          {turns.map((turn) => {
            const classification = pickSafeClassification(turn.classification);
            const snapshot = turn.contextSnapshot;
            const countsJson = jsonPreview(snapshot?.counts);
            const omissionsJson = jsonPreview(snapshot?.omissions);
            return (
              <li key={turn.id}>
                <details className="group">
                  <summary className="hover:bg-muted/40 grid cursor-pointer grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 px-4 py-2 text-sm sm:grid-cols-[10rem_1fr_auto]">
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {dateTime(turn.createdAt)}
                    </span>
                    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <TurnStatusBadge status={turn.status} />
                      <TurnRouteBadge route={turn.route} />
                      {turn.qualityScore !== null &&
                      turn.qualityScore !== undefined ? (
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-xs font-medium tabular-nums",
                            turn.qualityScore >= 4
                              ? "bg-semantic-success/10 text-semantic-success"
                              : turn.qualityScore >= 3
                                ? "bg-semantic-warning/10 text-semantic-warning"
                                : "bg-semantic-destructive/10 text-semantic-destructive",
                          )}
                        >
                          {turn.qualityScore}/5
                        </span>
                      ) : null}
                      {turn.versionId ? (
                        <span className="text-muted-foreground rounded border px-1.5 py-0.5 font-mono text-xs">
                          {turn.versionId}
                        </span>
                      ) : null}
                      {classification.confidence ? (
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {classification.confidence}
                        </span>
                      ) : null}
                      <span className="text-muted-foreground text-xs">
                        {t(`source.${turn.source}`)}
                      </span>
                      <span className="block w-full truncate">
                        {turn.userMessage}
                      </span>
                    </span>
                    <span className="text-muted-foreground col-span-2 flex flex-wrap gap-x-2 text-xs tabular-nums sm:col-span-1 sm:justify-end">
                      {turn.modelId ? (
                        <span className="font-mono">{turn.modelId}</span>
                      ) : null}
                      {turn.usage ? (
                        <span>
                          {formatTokens(
                            turn.usage.inputTokens + turn.usage.outputTokens,
                          )}{" "}
                          {t("tokensShort")} · {formatUsd(turn.usage.costUsd)}
                        </span>
                      ) : null}
                      <span>{formatDurationMs(turn.durationMs) ?? "—"}</span>
                    </span>
                  </summary>

                  <div className="space-y-5 border-t px-4 py-4">
                    <MetaGrid
                      columns={4}
                      items={[
                        { label: t("turnId"), value: turn.id, mono: true },
                        {
                          label: t("clientTurnId"),
                          value: turn.clientTurnId,
                          mono: true,
                        },
                        {
                          label: t("workspaceId"),
                          value: turn.workspaceId,
                          mono: true,
                        },
                        {
                          label: t("eveSessionId"),
                          value: turn.eveSessionId,
                          mono: true,
                        },
                        {
                          label: t("eveTurnId"),
                          value: turn.eveTurnId,
                          mono: true,
                        },
                        {
                          label: t("runtimeVersion"),
                          value: turn.runtimeVersion,
                          mono: true,
                        },
                        {
                          label: t("startedAt"),
                          value: dateTime(turn.startedAt),
                        },
                        {
                          label: t("completedAt"),
                          value: dateTime(turn.completedAt),
                        },
                        {
                          label: t("deadlineAt"),
                          value: dateTime(turn.deadlineAt),
                        },
                        {
                          label: t("cancellationRequestedAt"),
                          value: dateTime(turn.cancellationRequestedAt),
                        },
                        {
                          label: t("errorKind"),
                          value: turn.errorKind ? (
                            <span className="text-semantic-destructive">
                              {turn.errorKind}
                            </span>
                          ) : null,
                        },
                        {
                          label: t("errorDetail"),
                          value: turn.errorDetail,
                        },
                      ]}
                    />

                    <div className="space-y-2">
                      <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                        {t("classification")}
                      </h3>
                      <MetaGrid
                        columns={4}
                        items={[
                          {
                            label: t("route"),
                            value: <TurnRouteBadge route={turn.route} />,
                          },
                          {
                            label: t("confidence"),
                            value: classification.confidence,
                          },
                          {
                            label: t("classifierModel"),
                            value: turn.classifierModel,
                            mono: true,
                          },
                          {
                            label: t("classifierVersion"),
                            value: turn.classifierVersion,
                            mono: true,
                          },
                          {
                            label: t("classifierLatency"),
                            value: formatDurationMs(turn.classifierLatencyMs),
                          },
                          {
                            label: t("classificationFailed"),
                            value: yesNo(turn.classificationFailed),
                          },
                          {
                            label: t("requiresClarification"),
                            value: yesNo(classification.requiresClarification),
                          },
                          {
                            label: t("requiresApproval"),
                            value: yesNo(classification.requiresApproval),
                          },
                        ]}
                      />
                      {classification.requestedOutcome ? (
                        <p className="text-sm">
                          <span className="text-muted-foreground text-xs">
                            {t("requestedOutcome")}:{" "}
                          </span>
                          {classification.requestedOutcome}
                        </p>
                      ) : null}
                      {classification.rationaleSummary ? (
                        <p className="text-sm">
                          <span className="text-muted-foreground text-xs">
                            {t("rationaleSummary")}:{" "}
                          </span>
                          {classification.rationaleSummary}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-muted-foreground text-xs">
                          {t("capabilities")}:
                        </span>
                        {turn.capabilityNames.length === 0 ? (
                          <span className="text-muted-foreground text-xs">
                            —
                          </span>
                        ) : (
                          turn.capabilityNames.map((name) => (
                            <code
                              key={name}
                              className="bg-muted rounded border px-1.5 py-0.5 font-mono text-xs"
                            >
                              {name}
                            </code>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        {t("Quality.title")}
                      </h3>
                      <TurnQuality
                        score={turn.qualityScore}
                        verdict={turn.qualityVerdict}
                        model={turn.qualityModel}
                        judgedAt={
                          turn.judgedAt ? dateTime(turn.judgedAt) : null
                        }
                        source={turn.source}
                      />
                    </div>

                    <div className="space-y-2">
                      <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                        {t("modelUsage")}
                      </h3>
                      <MetaGrid
                        columns={4}
                        items={[
                          {
                            label: t("modelId"),
                            value: turn.modelId,
                            mono: true,
                          },
                          {
                            label: t("inputTokens"),
                            value: turn.usage
                              ? format.number(turn.usage.inputTokens)
                              : null,
                          },
                          {
                            label: t("outputTokens"),
                            value: turn.usage
                              ? format.number(turn.usage.outputTokens)
                              : null,
                          },
                          {
                            label: t("cacheReadTokens"),
                            value: turn.usage
                              ? format.number(turn.usage.cacheReadTokens)
                              : null,
                          },
                          {
                            label: t("cacheWriteTokens"),
                            value: turn.usage
                              ? format.number(turn.usage.cacheWriteTokens)
                              : null,
                          },
                          {
                            label: t("costUsd"),
                            value: turn.usage
                              ? formatUsd(turn.usage.costUsd)
                              : null,
                          },
                        ]}
                      />
                      {!turn.usage ? (
                        <p className="text-muted-foreground text-xs">
                          {t("noUsage")}
                        </p>
                      ) : null}
                    </div>

                    <div className="space-y-2">
                      <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                        {t("contextSnapshot")}
                      </h3>
                      {snapshot ? (
                        <>
                          <MetaGrid
                            columns={4}
                            items={[
                              {
                                label: t("snapshotId"),
                                value: snapshot.id,
                                mono: true,
                              },
                              {
                                label: t("schemaVersion"),
                                value: snapshot.schemaVersion,
                              },
                              {
                                label: t("hash"),
                                value: shortId(snapshot.hash),
                                mono: true,
                              },
                              {
                                label: t("byteSize"),
                                value: formatBytes(snapshot.byteSize),
                              },
                              {
                                label: t("tokenEstimate"),
                                value: snapshot.tokenEstimate,
                              },
                              {
                                label: t("generatedAt"),
                                value: dateTime(snapshot.generatedAt),
                              },
                            ]}
                          />
                          {countsJson || omissionsJson ? (
                            <div className="grid gap-3 sm:grid-cols-2">
                              {countsJson ? (
                                <div className="space-y-1">
                                  <p className="text-muted-foreground text-xs">
                                    {t("counts")}
                                  </p>
                                  <pre className="bg-muted/40 max-h-48 overflow-auto rounded border p-2 font-mono text-xs">
                                    {countsJson}
                                  </pre>
                                </div>
                              ) : null}
                              {omissionsJson ? (
                                <div className="space-y-1">
                                  <p className="text-muted-foreground text-xs">
                                    {t("omissions")}
                                  </p>
                                  <pre className="bg-muted/40 max-h-48 overflow-auto rounded border p-2 font-mono text-xs">
                                    {omissionsJson}
                                  </pre>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <p className="text-muted-foreground text-xs">
                          {t("noSnapshot")}
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                        {t("conversation")}
                      </h3>
                      <p className="whitespace-pre-wrap text-sm">
                        <span className="text-muted-foreground text-xs">
                          {t("user")}:{" "}
                        </span>
                        {turn.userMessage}
                      </p>
                      {turn.finalAnswer ? (
                        <p className="whitespace-pre-wrap text-sm">
                          <span className="text-muted-foreground text-xs">
                            {t("answer")}:{" "}
                          </span>
                          {turn.finalAnswer}
                        </p>
                      ) : null}
                    </div>

                    <div className="space-y-2">
                      <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                        {t("activity")}
                      </h3>
                      <TurnActivity
                        events={turn.events}
                        toolCalls={turn.toolCalls}
                        delegations={turn.delegations}
                        decisions={turn.pendingDecisions}
                      />
                    </div>
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

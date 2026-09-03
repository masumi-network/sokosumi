"use client";

import {
  evaluateScenario,
  type ScenarioResult,
  SOKO_BOT_SCENARIOS,
  type SokoBotScenario,
} from "@sokosumi/soko-bot";
import { Check, Play, X } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { parseAsString, useQueryState } from "nuqs";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatUsd } from "@/components/soko-bot/format";
import { Button } from "@/components/ui/button";
import {
  judgeSokoBotLabTurnAction,
  listSokoBotLabRunsAction,
  runSokoBotLabIngestAction,
  setSokoBotVersionAction,
  simulateSokoBotTaskEventAction,
  startSokoBotTurnAction,
} from "@/lib/actions/soko-bot/action";
import type {
  SokoBotLabRun,
  SokoBotLabVerdict,
  SokoBotVersion,
} from "@/lib/clients/generated/core";
import type { ChatTurnDetail } from "@/lib/soko-bot/chat-state";
import { cn } from "@/lib/utils";

// A run is watched, not waited on, so this is a refresh rate rather than a
// timeout budget: at three seconds a whole scenario could finish between two
// polls and never show a step.
const POLL_MS = 1_200;
const TIMEOUT_MS = 5 * 60_000;
const HISTORY_PER_SCENARIO = 8;

interface RunRecord {
  turnId: string;
  at: string;
  versionId: string | null;
  passed: number;
  total: number;
  durationMs: number | null;
  costUsd: number | null;
  checks: ScenarioResult["checks"];
  judge: SokoBotLabVerdict | null;
}

type History = Record<string, RunRecord[]>;

/** Server-recorded runs, newest first, grouped by scenario. */
function toHistory(runs: SokoBotLabRun[]): History {
  const history: History = {};
  for (const run of runs) {
    const record: RunRecord = {
      turnId: run.turnId,
      at: new Date(run.createdAt).toISOString(),
      versionId: run.versionId,
      passed: run.passed,
      total: run.total,
      durationMs: run.durationMs,
      costUsd: run.costUsd,
      checks: run.checks,
      judge: run.judge ? { model: run.judgeModel ?? "", ...run.judge } : null,
    };
    history[run.scenarioId] = [
      ...(history[run.scenarioId] ?? []),
      record,
    ].slice(0, HISTORY_PER_SCENARIO);
  }
  return history;
}

/** What the lab is doing right now, in the order it happens. */
type LivePhase = "starting" | "queued" | "running" | "judging";

interface LiveRun {
  scenarioId: string;
  phase: LivePhase;
  /** Null until the trigger hands one back. */
  turnId: string | null;
  turn: ChatTurnDetail | null;
  startedAt: number;
}

async function fetchTurn(turnId: string): Promise<ChatTurnDetail | null> {
  const response = await fetch(
    `/api/personal-assistant/turns/${encodeURIComponent(turnId)}`,
    { credentials: "same-origin", cache: "no-store" },
  );
  if (!response.ok) return null;
  const body = (await response.json()) as { turn?: ChatTurnDetail };
  return body.turn ?? null;
}

const FINAL_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

/**
 * Watches a turn to completion, reporting every poll rather than only the
 * last. The turn carries its tool calls as they land, so the caller can show
 * the step the assistant is on instead of a spinner over the previous result.
 */
async function watchTurn(
  turnId: string,
  onProgress: (turn: ChatTurnDetail) => void,
): Promise<ChatTurnDetail | null> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const turn = await fetchTurn(turnId);
    if (turn) {
      onProgress(turn);
      if (FINAL_STATUSES.has(turn.status)) return turn;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return null;
}

/**
 * Behaviour lab: six fixed prompts, each run as a real turn against the
 * live assistant, scored against what we expect it to do. Results stay in
 * this browser so a prompt or model change can be compared with the last
 * runs. Runs create real tasks and approvals in the owner's workspace.
 */
/** Ticks once a second so an elapsed time is not frozen at its first render. */
function useElapsed(since: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.round((now - since) / 1000));
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return minutes > 0
    ? `${minutes}:${String(seconds % 60).padStart(2, "0")}`
    : `${seconds}s`;
}

/**
 * What the assistant is doing, right now, in the order it happened.
 *
 * Without this the row kept showing the previous run's verdict under a
 * spinner, which is the one thing a reader must not mistake for the current
 * one — so this replaces that result while a run is in flight.
 */
function LiveRunPanel({ live }: { live: LiveRun }) {
  const t = useTranslations("App.Admin.SokoBots.Lab");
  const elapsed = useElapsed(live.startedAt);
  const calls = live.turn?.toolCalls ?? [];
  const phaseLabel =
    live.phase === "starting"
      ? t("phaseStarting")
      : live.phase === "queued"
        ? t("phaseQueued")
        : live.phase === "judging"
          ? t("phaseJudging")
          : t("phaseRunning");

  return (
    <div className="border-primary/40 bg-primary/5 mt-3 rounded-md border px-3 py-2">
      <p className="flex items-center gap-2 text-xs font-medium">
        <span
          className="bg-primary size-1.5 shrink-0 animate-pulse rounded-full"
          aria-hidden
        />
        {phaseLabel}
        <span className="text-muted-foreground ml-auto font-normal tabular-nums">
          {formatDuration(elapsed)}
        </span>
      </p>

      {live.turn?.route ? (
        <p className="text-muted-foreground mt-1 text-xs">
          {t("liveRoute", { route: live.turn.route })}
        </p>
      ) : null}

      {calls.length > 0 ? (
        <ol className="mt-2 space-y-1">
          {calls.map((call, index) => (
            <li
              key={call.id}
              className="flex items-baseline gap-2 font-mono text-[0.6875rem]"
            >
              <span className="text-muted-foreground w-4 shrink-0 text-right tabular-nums">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate">{call.capability}</span>
              <span
                className={cn(
                  "shrink-0",
                  call.status === "FAILED"
                    ? "text-semantic-destructive"
                    : call.status === "COMPLETED"
                      ? "text-muted-foreground"
                      : "text-primary",
                )}
              >
                {call.status === "FAILED"
                  ? t("stepFailed")
                  : call.status === "COMPLETED"
                    ? t("stepDone")
                    : t("stepWorking")}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-muted-foreground mt-2 text-xs">{t("liveNoSteps")}</p>
      )}

      {/* The one thing that explains a failed step without opening the turn. */}
      {calls.find((call) => call.status === "FAILED")?.errorDetail ? (
        <p className="text-semantic-destructive mt-2 text-xs">
          {calls.find((call) => call.status === "FAILED")?.errorDetail}
        </p>
      ) : null}
    </div>
  );
}

export function ScenarioLab({
  versionId,
  versions,
  onTurnFinished,
}: {
  versionId: string | null;
  versions: SokoBotVersion[];
  onTurnFinished?: () => void;
}) {
  const t = useTranslations("App.Admin.SokoBots.Lab");
  const [history, setHistory] = useState<History>({});
  const [activeVersion, setActiveVersion] = useState<string | null>(versionId);
  const activeVersionRef = useRef<string | null>(versionId);
  const [requestedVersionId, setRequestedVersionId] = useQueryState(
    "version",
    parseAsString.withOptions({ history: "replace" }),
  );
  const [switching, setSwitching] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const current = versions.find((v) => v.id === activeVersion) ?? null;

  useEffect(() => {
    let cancelled = false;
    const fallbackVersionId = versionId ?? versions[0]?.id ?? null;
    const requested = versions.some(
      (version) => version.id === requestedVersionId,
    )
      ? requestedVersionId
      : null;
    if (requestedVersionId && !requested) {
      void setRequestedVersionId(null);
    }
    if (!requested || requested === activeVersionRef.current) {
      activeVersionRef.current = requested ?? fallbackVersionId;
      setActiveVersion(requested ?? fallbackVersionId);
      return;
    }

    setSwitching(true);
    void setSokoBotVersionAction({ versionId: requested }).then(
      (switchResult) => {
        if (cancelled) return;
        setSwitching(false);
        if (!switchResult.ok) {
          void setRequestedVersionId(null);
          return;
        }
        activeVersionRef.current = requested;
        setActiveVersion(requested);
        onTurnFinished?.();
      },
    );
    return () => {
      cancelled = true;
    };
  }, [
    onTurnFinished,
    requestedVersionId,
    setRequestedVersionId,
    versionId,
    versions,
  ]);

  async function chooseVersion(id: string) {
    setSwitching(true);
    const result = await setSokoBotVersionAction({ versionId: id });
    setSwitching(false);
    if (result.ok) {
      activeVersionRef.current = id;
      setActiveVersion(id);
      await setRequestedVersionId(id);
      onTurnFinished?.();
    }
  }
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [failures, setFailures] = useState<Record<string, string>>({});
  // One at a time: turns share the bot's session lock, so this is the run the
  // whole page is waiting on rather than one of several.
  const [live, setLive] = useState<LiveRun | null>(null);
  /** Where a Run all has got to, so the wait has a denominator. */
  const [batch, setBatch] = useState<{
    done: number;
    total: number;
    startedAt: number;
  } | null>(null);

  const loadHistory = useCallback(async () => {
    const result = await listSokoBotLabRunsAction({});
    if (result.ok) setHistory(toHistory(result.value));
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  async function run(scenario: SokoBotScenario) {
    setRunning((current) => new Set(current).add(scenario.id));
    setFailures(({ [scenario.id]: _dropped, ...rest }) => rest);
    setLive({
      scenarioId: scenario.id,
      phase: "starting",
      turnId: null,
      turn: null,
      startedAt: Date.now(),
    });
    try {
      let turnId: string | null;
      if (scenario.trigger?.kind === "ingest") {
        // Core builds the same packet the cron would and starts the turn. It
        // answers with what to connect when the beat reads an account the bot
        // has not linked, which is far more use than the terminal this used
        // to point at.
        const ingest = await runSokoBotLabIngestAction({
          input: { beat: scenario.trigger.beat },
        });
        if (!ingest.ok) {
          setFailures((current) => ({
            ...current,
            [scenario.id]: ingest.error.message ?? t("startError"),
          }));
          return;
        }
        turnId = ingest.value.turnId;
      } else if (scenario.trigger?.kind === "task_event") {
        const simulated = await simulateSokoBotTaskEventAction({
          input: {
            status: scenario.trigger.status,
            comment: scenario.trigger.comment,
          },
        });
        if (!simulated.ok) {
          setFailures((current) => ({
            ...current,
            [scenario.id]: simulated.error.message ?? t("startError"),
          }));
          return;
        }
        // The simulation starts the turn and hands back its id. It used to
        // be left to the one-minute events cron and found by scanning state
        // for a turn whose text mentioned the task, which reported "no turn"
        // for every reason a wake can be withheld.
        turnId = simulated.value.turnId;
      } else {
        const started = await startSokoBotTurnAction({
          input: {
            clientTurnId: `lab:${scenario.id}:${crypto.randomUUID()}`,
            message: scenario.prompt,
          },
        });
        if (!started.ok) {
          setFailures((current) => ({
            ...current,
            [scenario.id]: started.error.message ?? t("startError"),
          }));
          return;
        }
        turnId = started.value.turnId;
      }
      if (!turnId) {
        setFailures((current) => ({
          ...current,
          [scenario.id]: t("noTurn"),
        }));
        return;
      }
      setLive((current) =>
        current?.scenarioId === scenario.id
          ? { ...current, phase: "queued", turnId }
          : current,
      );
      const turn = await watchTurn(turnId, (progress) => {
        setLive((current) =>
          current?.scenarioId === scenario.id
            ? {
                ...current,
                phase: FINAL_STATUSES.has(progress.status)
                  ? "judging"
                  : "running",
                turn: progress,
              }
            : current,
        );
      });
      if (!turn) {
        setFailures((current) => ({
          ...current,
          [scenario.id]: t("timeout", { turnId }),
        }));
        return;
      }
      const result = evaluateScenario(scenario, turn);
      await judgeSokoBotLabTurnAction({
        input: {
          turnId: turn.id,
          scenarioId: scenario.id,
          evaluation: {
            passed: result.passed,
            total: result.total,
            checks: result.checks,
          },
        },
      });
      await loadHistory();
      onTurnFinished?.();
    } finally {
      setRunning((current) => {
        const next = new Set(current);
        next.delete(scenario.id);
        return next;
      });
      setLive((current) =>
        current?.scenarioId === scenario.id ? null : current,
      );
    }
  }

  async function runAll() {
    // Sequential: turns share the bot's session lock and the context they read.
    setBatch({
      done: 0,
      total: SOKO_BOT_SCENARIOS.length,
      startedAt: Date.now(),
    });
    try {
      for (const scenario of SOKO_BOT_SCENARIOS) {
        await run(scenario);
        setBatch((current) =>
          current ? { ...current, done: current.done + 1 } : current,
        );
      }
    } finally {
      setBatch(null);
    }
  }

  async function runAllVersions() {
    setBatch({
      done: 0,
      total: versions.length * SOKO_BOT_SCENARIOS.length,
      startedAt: Date.now(),
    });
    try {
      for (const version of versions) {
        await chooseVersion(version.id);
        for (const scenario of SOKO_BOT_SCENARIOS) {
          await run(scenario);
          setBatch((current) =>
            current ? { ...current, done: current.done + 1 } : current,
          );
        }
      }
    } finally {
      setBatch(null);
    }
  }

  const anyRunning = running.size > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs">{t("version")}</span>
        {versions.map((version) => (
          <button
            key={version.id}
            type="button"
            disabled={anyRunning || switching}
            onClick={() => void chooseVersion(version.id)}
            title={version.summary}
            className={cn(
              "rounded-md border px-2 py-1 text-xs transition-colors",
              activeVersion === version.id
                ? "border-primary bg-primary/5 text-foreground"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {version.name}
          </button>
        ))}
      </div>
      {current ? (
        <div className="bg-muted/30 rounded-lg border px-4 py-3 text-xs">
          <p className="text-foreground text-sm font-medium">
            {current.name}
            <span className="text-muted-foreground ml-2 font-normal tabular-nums">
              {current.createdAt}
            </span>
          </p>
          <p className="text-muted-foreground mt-1">{current.summary}</p>
          <dl className="mt-2 grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">{t("overviewModel")}</dt>
            <dd className="font-mono">{current.model}</dd>
            <dt className="text-muted-foreground">{t("overviewSkills")}</dt>
            <dd>
              {current.skills.length > 0
                ? current.skills.map((skill) => skill.name).join(", ")
                : "—"}
            </dd>
            <dt className="text-muted-foreground">{t("overviewTools")}</dt>
            <dd>
              {current.capabilities?.length
                ? current.capabilities.join(", ")
                : t("allTools")}
            </dd>
            <dt className="text-muted-foreground">{t("overviewPrompt")}</dt>
            <dd>
              <button
                type="button"
                onClick={() => setPromptOpen((v) => !v)}
                aria-expanded={promptOpen}
                className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
              >
                {promptOpen ? t("hidePrompt") : t("showPrompt")} ·{" "}
                {Math.round(current.systemPrompt.length / 1024)} KB
              </button>
              {promptOpen ? (
                <pre className="bg-background mt-2 max-h-96 overflow-auto rounded-md border p-2 font-mono text-[0.6875rem] leading-snug whitespace-pre-wrap break-words">
                  {current.systemPrompt}
                </pre>
              ) : null}
            </dd>
          </dl>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">{t("warning")}</p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={anyRunning || versions.length === 0}
            onClick={() => void runAllVersions()}
          >
            <Play aria-hidden className="size-3.5" />
            {t("runAllVersions", { count: versions.length })}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={anyRunning}
            onClick={() => void runAll()}
          >
            <Play aria-hidden className="size-3.5" />
            {t("runAll")}
          </Button>
        </div>
      </div>
      {batch ? <BatchProgress batch={batch} live={live} /> : null}
      <ol className="divide-y rounded-lg border">
        {SOKO_BOT_SCENARIOS.map((scenario) => (
          <ScenarioRow
            key={scenario.id}
            scenario={scenario}
            runs={(history[scenario.id] ?? []).filter(
              (run) => run.versionId === activeVersion,
            )}
            running={running.has(scenario.id)}
            live={live?.scenarioId === scenario.id ? live : null}
            disabled={anyRunning}
            failure={failures[scenario.id] ?? null}
            onRun={() => void run(scenario)}
          />
        ))}
      </ol>
    </div>
  );
}

/** How far a Run all has got, so the wait has a denominator and an end. */
function BatchProgress({
  batch,
  live,
}: {
  batch: { done: number; total: number; startedAt: number };
  live: LiveRun | null;
}) {
  const t = useTranslations("App.Admin.SokoBots.Lab");
  const elapsed = useElapsed(batch.startedAt);
  const current = SOKO_BOT_SCENARIOS.find(
    (scenario) => scenario.id === live?.scenarioId,
  );
  const percent = Math.round((batch.done / Math.max(1, batch.total)) * 100);

  return (
    <div className="rounded-lg border px-4 py-3">
      <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
        <span className="font-medium tabular-nums">
          {t("batchProgress", { done: batch.done, total: batch.total })}
        </span>
        {current ? (
          <span className="text-muted-foreground truncate">
            {current.title}
          </span>
        ) : null}
        <span className="text-muted-foreground ml-auto tabular-nums">
          {formatDuration(elapsed)}
        </span>
      </p>
      <div
        className="bg-muted mt-2 h-1 overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={batch.done}
        aria-valuemin={0}
        aria-valuemax={batch.total}
      >
        <div
          className="bg-primary h-full transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function ScenarioRow({
  scenario,
  runs,
  running,
  live,
  disabled,
  failure,
  onRun,
}: {
  scenario: SokoBotScenario;
  runs: RunRecord[];
  running: boolean;
  live: LiveRun | null;
  disabled: boolean;
  failure: string | null;
  onRun: () => void;
}) {
  const t = useTranslations("App.Admin.SokoBots.Lab");
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLLIElement | null>(null);
  const latest = runs[0] ?? null;
  // The row being run opens itself: the steps are the reason to look here, and
  // needing a click to see them is what made a run feel like a frozen page.
  const expanded = open || live !== null;

  // A Run all works through twenty-two scenarios; without this the one being
  // run is usually somewhere off-screen.
  const isLive = live !== null;
  useEffect(() => {
    if (!isLive) return;
    rowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [isLive]);

  return (
    <li ref={rowRef} className="px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={expanded}
            className="text-left"
          >
            <span className="text-sm font-medium">{scenario.title}</span>
            <span className="text-muted-foreground block text-xs">
              {scenario.intent}
            </span>
          </button>
        </div>
        {/* Dimmed with the rest of the previous result: at full strength
            beside a live run it reads as the score being produced. */}
        <div className={cn(live && "opacity-60")}>
          <ScoreTrail runs={runs} />
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={onRun}
        >
          <Play
            aria-hidden
            className={cn("size-3.5", running && "animate-pulse")}
          />
          {running ? t("running") : t("run")}
        </Button>
      </div>
      {failure ? (
        <p className="text-semantic-destructive mt-2 text-xs">{failure}</p>
      ) : null}
      {live ? <LiveRunPanel live={live} /> : null}
      {expanded ? (
        <div className="mt-3 space-y-3">
          <blockquote className="text-muted-foreground border-l-2 pl-3 text-xs leading-relaxed">
            {scenario.trigger?.kind === "task_event"
              ? `Coworker sets the newest delegated task to ${scenario.trigger.status}: “${scenario.trigger.comment}”`
              : scenario.trigger?.kind === "ingest"
                ? `Self-started ${scenario.trigger.beat} turn from the connected mail and calendar.`
                : scenario.prompt}
          </blockquote>
          {latest ? (
            <div className={cn("space-y-2", live && "opacity-60")}>
              {/* Named while a run is in flight, so the verdict on screen is
                  never mistaken for the one being produced. */}
              {live ? (
                <p className="text-muted-foreground text-xs font-medium">
                  {t("previousRun")}
                </p>
              ) : null}
              <p
                className="text-muted-foreground text-xs tabular-nums"
                suppressHydrationWarning
              >
                {t("lastRun", {
                  time: format.relativeTime(new Date(latest.at), new Date()),
                })}
                {latest.durationMs
                  ? ` · ${Math.round(latest.durationMs / 1000)}s`
                  : ""}
                {latest.costUsd !== null
                  ? ` · ${formatUsd(latest.costUsd)}`
                  : ""}
                {" · "}
                <Link
                  href={`/personal-assistant?turn=${encodeURIComponent(latest.turnId)}`}
                  className="hover:text-foreground underline-offset-4 hover:underline"
                >
                  {t("openTurn")}
                </Link>
              </p>
              {latest.judge ? (
                <div
                  className={cn(
                    "rounded-md border px-3 py-2 text-xs",
                    latest.judge.verdict === "pass"
                      ? "border-semantic-success/40"
                      : latest.judge.verdict === "weak"
                        ? "border-semantic-warning/40"
                        : "border-semantic-destructive/40",
                  )}
                >
                  <p className="font-medium">
                    {t("judge")} ({latest.judge.model || "—"}) ·{" "}
                    {latest.judge.verdict}
                    <span className="text-muted-foreground ml-2 font-normal tabular-nums">
                      {t("judgeScores", {
                        d: latest.judge.scores.delegation,
                        f: latest.judge.scores.followThrough,
                        j: latest.judge.scores.judgment,
                        h: latest.judge.scores.honesty,
                      })}
                    </span>
                  </p>
                  <p className="text-muted-foreground mt-1">
                    {latest.judge.rationale}
                  </p>
                  {latest.judge.issues.length > 0 ? (
                    <ul className="text-muted-foreground mt-1 list-disc pl-4">
                      {latest.judge.issues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {/* Failures first. Nine rows of mostly ticks buries the two that
                  matter, and the reader should not have to hunt for them. */}
              {latest.checks.some((check) => !check.pass) ? (
                <p className="text-semantic-destructive text-xs font-medium">
                  {t("failedChecks", {
                    labels: latest.checks
                      .filter((check) => !check.pass)
                      .map((check) => check.label)
                      .join(", "),
                  })}
                </p>
              ) : null}
              <ul className="space-y-1">
                {[...latest.checks]
                  .sort((a, b) => Number(a.pass) - Number(b.pass))
                  .map((check) => (
                    <li
                      key={check.label}
                      className="flex items-start gap-2 text-xs"
                    >
                      {check.pass ? (
                        <Check
                          aria-hidden
                          className="text-semantic-success mt-0.5 size-3.5 shrink-0"
                        />
                      ) : (
                        <X
                          aria-hidden
                          className="text-semantic-destructive mt-0.5 size-3.5 shrink-0"
                        />
                      )}
                      <span className="min-w-0">
                        <span className="font-medium">{check.label}</span>
                        <span className="text-muted-foreground">
                          {" — "}
                          {check.actual}
                        </span>
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">{t("neverRun")}</p>
          )}
        </div>
      ) : null}
    </li>
  );
}

/** Newest run on the right; a full-score run is a solid dot. */
function ScoreTrail({ runs }: { runs: RunRecord[] }) {
  const t = useTranslations("App.Admin.SokoBots.Lab");
  if (runs.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 self-center">
      {[...runs].reverse().map((run) => (
        <span
          key={run.turnId}
          title={t("score", { passed: run.passed, total: run.total })}
          className={cn(
            "size-2 rounded-full",
            run.judge?.verdict === "fail" || run.passed === 0
              ? "bg-semantic-destructive"
              : run.passed === run.total && run.judge?.verdict !== "weak"
                ? "bg-semantic-success"
                : "bg-semantic-warning",
          )}
        />
      ))}
      <span className="text-muted-foreground ml-1 text-xs tabular-nums">
        {runs[0]?.passed}/{runs[0]?.total}
      </span>
    </div>
  );
}

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
import { useEffect, useState } from "react";
import { formatUsd } from "@/components/soko-bot/format";
import { Button } from "@/components/ui/button";
import {
  judgeSokoBotLabTurnAction,
  listSokoBotVersionsAction,
  setSokoBotVersionAction,
  simulateSokoBotTaskEventAction,
  startSokoBotTurnAction,
} from "@/lib/actions/soko-bot/action";
import type {
  SokoBotLabVerdict,
  SokoBotVersion,
} from "@/lib/clients/generated/core";
import type {
  ChatTurnDetail,
  SokoBotChatState,
} from "@/lib/soko-bot/chat-state";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "soko-bot-lab:v1";
const POLL_MS = 3_000;
const TIMEOUT_MS = 5 * 60_000;
const HISTORY_PER_SCENARIO = 5;

interface RunRecord {
  turnId: string;
  at: string;
  versionId: string | null;
  route: string | null;
  passed: number;
  total: number;
  durationMs: number | null;
  costUsd: number | null;
  checks: ScenarioResult["checks"];
  judge: SokoBotLabVerdict | null;
}

type History = Record<string, RunRecord[]>;

function readHistory(): History {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as History) : {};
  } catch {
    return {};
  }
}

function writeHistory(history: History) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Storage unavailable: results still show for this session.
  }
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

/** The EVENT turn the sync starts for a simulated Coworker event (next cron tick). */
async function waitForEventTurn(
  taskId: string,
  since: number,
): Promise<string | null> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await fetch("/api/personal-assistant/state", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (response.ok) {
      const body = (await response.json()) as {
        state?: SokoBotChatState | null;
      };
      const turn = body.state?.turns.find(
        (t) =>
          t.source === "EVENT" &&
          t.userMessage.includes(taskId) &&
          new Date(t.createdAt).getTime() >= since,
      );
      if (turn) return turn.id;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return null;
}

async function waitForTurn(turnId: string): Promise<ChatTurnDetail | null> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const turn = await fetchTurn(turnId);
    if (turn && FINAL_STATUSES.has(turn.status)) return turn;
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
export function ScenarioLab({
  versionId,
  onTurnFinished,
}: {
  versionId: string | null;
  onTurnFinished: () => void;
}) {
  const t = useTranslations("App.SokoBot.Lab");
  const [history, setHistory] = useState<History>({});
  const [versions, setVersions] = useState<SokoBotVersion[]>([]);
  const [activeVersion, setActiveVersion] = useState<string | null>(versionId);
  const [switching, setSwitching] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const current = versions.find((v) => v.id === activeVersion) ?? null;

  useEffect(() => {
    void listSokoBotVersionsAction({}).then((result) => {
      if (result.ok) {
        setVersions(result.value);
        setActiveVersion((current) => current ?? result.value[0]?.id ?? null);
      }
    });
  }, []);

  async function chooseVersion(id: string) {
    setSwitching(true);
    const result = await setSokoBotVersionAction({ versionId: id });
    setSwitching(false);
    if (result.ok) {
      setActiveVersion(id);
      onTurnFinished();
    }
  }
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [failures, setFailures] = useState<Record<string, string>>({});

  useEffect(() => {
    setHistory(readHistory());
  }, []);

  function record(scenarioId: string, run: RunRecord) {
    setHistory((current) => {
      const next = {
        ...current,
        [scenarioId]: [run, ...(current[scenarioId] ?? [])].slice(
          0,
          HISTORY_PER_SCENARIO,
        ),
      };
      writeHistory(next);
      return next;
    });
  }

  async function run(scenario: SokoBotScenario) {
    setRunning((current) => new Set(current).add(scenario.id));
    setFailures(({ [scenario.id]: _dropped, ...rest }) => rest);
    try {
      let turnId: string | null;
      if (scenario.trigger) {
        const since = Date.now() - 5_000;
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
        turnId = await waitForEventTurn(simulated.value.taskId, since);
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
      const turn = turnId ? await waitForTurn(turnId) : null;
      if (!turn) {
        setFailures((current) => ({
          ...current,
          [scenario.id]: t("timeout"),
        }));
        return;
      }
      const result = evaluateScenario(scenario, turn);
      const judged = await judgeSokoBotLabTurnAction({
        input: { turnId: turn.id, scenarioId: scenario.id },
      });
      record(scenario.id, {
        turnId: turn.id,
        at: new Date().toISOString(),
        versionId: activeVersion,
        route: turn.route,
        passed: result.passed,
        total: result.total,
        durationMs: turn.durationMs,
        costUsd: turn.usage?.costUsd ?? null,
        checks: result.checks,
        judge: judged.ok ? judged.value : null,
      });
      onTurnFinished();
    } finally {
      setRunning((current) => {
        const next = new Set(current);
        next.delete(scenario.id);
        return next;
      });
    }
  }

  async function runAll() {
    // Sequential: turns share the bot's session lock and the context they read.
    for (const scenario of SOKO_BOT_SCENARIOS) await run(scenario);
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
            <dd>{current.capabilities?.join(", ") ?? t("allTools")}</dd>
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
      <ol className="divide-y rounded-lg border">
        {SOKO_BOT_SCENARIOS.map((scenario) => (
          <ScenarioRow
            key={scenario.id}
            scenario={scenario}
            runs={(history[scenario.id] ?? []).filter(
              (run) => run.versionId === activeVersion,
            )}
            running={running.has(scenario.id)}
            disabled={anyRunning}
            failure={failures[scenario.id] ?? null}
            onRun={() => void run(scenario)}
          />
        ))}
      </ol>
    </div>
  );
}

function ScenarioRow({
  scenario,
  runs,
  running,
  disabled,
  failure,
  onRun,
}: {
  scenario: SokoBotScenario;
  runs: RunRecord[];
  running: boolean;
  disabled: boolean;
  failure: string | null;
  onRun: () => void;
}) {
  const t = useTranslations("App.SokoBot.Lab");
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const latest = runs[0] ?? null;

  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="text-left"
          >
            <span className="text-sm font-medium">{scenario.title}</span>
            <span className="text-muted-foreground block text-xs">
              {scenario.intent}
            </span>
          </button>
        </div>
        <ScoreTrail runs={runs} />
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
      {open ? (
        <div className="mt-3 space-y-3">
          <blockquote className="text-muted-foreground border-l-2 pl-3 text-xs leading-relaxed">
            {scenario.trigger
              ? `Coworker sets the newest delegated task to ${scenario.trigger.status}: “${scenario.trigger.comment}”`
              : scenario.prompt}
          </blockquote>
          {latest ? (
            <div className="space-y-2">
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
                    {t("judge")} · {latest.judge.verdict}
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
              <ul className="space-y-1">
                {latest.checks.map((check) => (
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
  const t = useTranslations("App.SokoBot.Lab");
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

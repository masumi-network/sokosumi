import type { CoreHttpClient } from "../../api/http-client.js";
import {
  type CommandContext,
  type CommandOptions,
  option,
  optionString,
  writeJson,
  writeText,
} from "./command-helpers.js";

/**
 * Eval runs from the terminal, for development: start a run, wait for it,
 * read what got better or worse. Platform admins only; Core refuses others.
 *
 *   sokosumi evals run --suite cmo --repeats 1 --wait
 *   sokosumi evals run --cases ambiguous-request,chat-post --wait --tick
 *   sokosumi evals show RUN_ID --markdown
 */
interface EvalsCommandContext extends CommandContext {
  subcommand?: string;
  positionalId?: string;
  options?: CommandOptions;
  /** Waits between polls; tests pass a stub. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const EVALS_COMMANDS = ["run", "show", "list", "cases"] as const;
const POLL_MS = 20_000;
const WAIT_LIMIT_MS = 6 * 60 * 60_000;
const OUTCOME_ORDER = [
  "regressed",
  "error",
  "failing",
  "flaky",
  "fixed",
  "passing",
  "pending",
  "skipped",
] as const;

interface EvalRun {
  id: string;
  createdAt: string;
  trigger: string;
  status: string;
  suites: string[];
  repeats: number;
  commitSha: string | null;
  prNumber: number | null;
  environment: string;
  models: Record<string, string | null>;
}

interface EvalCaseReport {
  caseId: string;
  suite: string;
  area: string;
  title: string;
  outcome: (typeof OUTCOME_ORDER)[number];
  states: string[];
  passRate: number | null;
  baselinePassRate: number | null;
  results: {
    repeat: number;
    status: string;
    error: string | null;
    checks: { label: string; pass: boolean; actual: string }[];
    judge: { verdict?: string; issues?: string[] } | null;
  }[];
}

interface EvalRunReport {
  run: EvalRun;
  baseline: { id: string; createdAt: string; prNumber: number | null } | null;
  summary: {
    counts: Record<string, number>;
    passed: number;
    scored: number;
    open: number;
    costUsd: number;
  };
  cases: EvalCaseReport[];
}

function data<T>(response: unknown): T {
  if (!response || typeof response !== "object" || !("data" in response))
    throw new Error("Invalid evals response: missing data");
  return (response as { data: T }).data;
}

function percent(rate: number | null): string {
  return rate === null ? "–" : `${Math.round(rate * 100)}%`;
}

function runRef(run: Pick<EvalRun, "prNumber" | "commitSha">): string {
  if (run.prNumber) return `#${run.prNumber}`;
  return run.commitSha ? run.commitSha.slice(0, 7) : "no commit";
}

/** Why a case did not pass, in one line: a failed check, the judge, or the error. */
function caseReason(evalCase: EvalCaseReport): string {
  for (const result of evalCase.results) {
    const check = result.checks.find((item) => !item.pass);
    if (check) return `${check.label}: ${check.actual}`.slice(0, 200);
  }
  for (const result of evalCase.results)
    if (result.judge?.verdict === "fail" && result.judge.issues?.[0])
      return `judge: ${result.judge.issues[0]}`.slice(0, 200);
  return (evalCase.results.find((result) => result.error)?.error ?? "").slice(
    0,
    200,
  );
}

function needsALook(evalCase: EvalCaseReport): boolean {
  return !["passing", "pending", "skipped"].includes(evalCase.outcome);
}

function sorted(cases: EvalCaseReport[]): EvalCaseReport[] {
  return [...cases].sort(
    (a, b) =>
      OUTCOME_ORDER.indexOf(a.outcome) - OUTCOME_ORDER.indexOf(b.outcome),
  );
}

function counts(report: EvalRunReport): string {
  return OUTCOME_ORDER.filter((outcome) => report.summary.counts[outcome])
    .map((outcome) => `${report.summary.counts[outcome]} ${outcome}`)
    .join(" · ");
}

function formatReportText(report: EvalRunReport): string[] {
  const { run, summary } = report;
  const rate = summary.scored ? summary.passed / summary.scored : null;
  return [
    `Eval run ${run.id} · ${run.trigger.toLowerCase()} · ${run.environment} · ${runRef(run)} · ${run.status.toLowerCase()}`,
    `${percent(rate)} passed (${summary.passed} of ${summary.scored})${summary.open ? `, ${summary.open} to go` : ""} · $${summary.costUsd.toFixed(2)}`,
    report.baseline
      ? `Compared with the daily run of ${report.baseline.createdAt} (${runRef({ prNumber: report.baseline.prNumber, commitSha: null })})`
      : "No daily run before this one to compare with.",
    counts(report),
    ...sorted(report.cases)
      .filter(needsALook)
      .map(
        (evalCase) =>
          `${evalCase.outcome.toUpperCase().padEnd(9)} ${evalCase.caseId} ${percent(evalCase.passRate)} (was ${percent(evalCase.baselinePassRate)})  ${caseReason(evalCase)}`,
      ),
  ];
}

/** The table a PR's Evidence section takes. */
function formatReportMarkdown(report: EvalRunReport): string[] {
  const { run, summary } = report;
  const suites = [...new Set(report.cases.map((evalCase) => evalCase.suite))];
  const lines = [
    `**Evals** (${run.environment}, ${runRef(run)}, ${run.repeats} ${run.repeats === 1 ? "repeat" : "repeats"}${report.baseline ? `, vs daily run ${runRef({ prNumber: report.baseline.prNumber, commitSha: null })}` : ""})`,
    "",
    "| Suite | Passed | Regressed | Fixed | Flaky | Failing |",
    "| --- | --- | --- | --- | --- | --- |",
    ...suites.map((suite) => {
      const cases = report.cases.filter((evalCase) => evalCase.suite === suite);
      const count = (outcome: string) =>
        cases.filter((evalCase) => evalCase.outcome === outcome).length;
      const results = cases.flatMap((evalCase) => evalCase.states);
      const passed = results.filter((state) => state === "PASSED").length;
      const scored = results.filter((state) =>
        ["PASSED", "FAILED", "ERROR"].includes(state),
      ).length;
      return `| ${suite} | ${passed}/${scored} | ${count("regressed")} | ${count("fixed")} | ${count("flaky")} | ${count("failing") + count("error")} |`;
    }),
  ];
  const changed = sorted(report.cases).filter(
    (evalCase) =>
      evalCase.outcome === "regressed" || evalCase.outcome === "fixed",
  );
  if (changed.length)
    lines.push(
      "",
      ...changed.map(
        (evalCase) =>
          `- ${evalCase.outcome === "regressed" ? "▼" : "▲"} \`${evalCase.caseId}\` ${percent(evalCase.baselinePassRate)} → ${percent(evalCase.passRate)}${evalCase.outcome === "regressed" ? `: ${caseReason(evalCase)}` : ""}`,
      ),
    );
  lines.push("", `Cost $${summary.costUsd.toFixed(2)} · run \`${run.id}\``);
  return lines;
}

function validate(context: EvalsCommandContext) {
  const subcommand = EVALS_COMMANDS.find(
    (command) => command === context.subcommand,
  );
  if (!subcommand)
    throw new Error(
      "Usage: sokosumi evals run|show|list|cases [options]. See sokosumi --help.",
    );
  if (subcommand === "show" && !context.positionalId)
    throw new Error("Usage: sokosumi evals show RUN_ID [--markdown]");
  if (subcommand !== "show" && context.positionalId)
    throw new Error(`Unexpected argument: ${context.positionalId}`);
  return subcommand;
}

function runBody(options: CommandOptions | undefined) {
  const suite = optionString(options, "suite");
  if (suite && !["soko-bot", "cmo", "all"].includes(suite))
    throw new Error("--suite is soko-bot, cmo or all");
  const cases = optionString(options, "cases")
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const repeatsInput = optionString(options, "repeats");
  const repeats = repeatsInput === undefined ? undefined : Number(repeatsInput);
  if (
    repeats !== undefined &&
    (!Number.isInteger(repeats) || repeats < 1 || repeats > 3)
  )
    throw new Error("--repeats is 1, 2 or 3");
  const version = optionString(options, "soko-bot-version");
  const cusoVersion = optionString(options, "cuso-version");
  return {
    ...(suite && suite !== "all" ? { suites: [suite] } : {}),
    ...(cases?.length ? { caseIds: cases } : {}),
    ...(repeats ? { repeats } : {}),
    ...(version ? { sokoBotVersionId: version } : {}),
    ...(cusoVersion ? { cusoVersionId: cusoVersion } : {}),
  };
}

async function waitForRun(
  client: CoreHttpClient,
  runId: string,
  context: EvalsCommandContext,
): Promise<EvalRunReport> {
  const sleep =
    context.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const tick = option(context.options, "tick") === true;
  const deadline = Date.now() + WAIT_LIMIT_MS;
  let lastOpen = -1;
  for (;;) {
    if (tick) await client.post("/v1/admin/evals/tick", {}, context.signal);
    const report = data<EvalRunReport>(
      await client.get(`/v1/admin/evals/runs/${runId}`, context.signal),
    );
    if (report.run.status === "COMPLETED" || report.run.status === "CANCELLED")
      return report;
    if (!context.json && report.summary.open !== lastOpen) {
      writeText(context.stdout, [
        `${report.run.status.toLowerCase()}: ${report.summary.open} to go, ${report.summary.passed} of ${report.summary.scored} passed so far`,
      ]);
      lastOpen = report.summary.open;
    }
    if (Date.now() > deadline)
      throw new Error(
        `Run ${runId} is still ${report.run.status} after 6 hours`,
      );
    await sleep(POLL_MS, context.signal);
  }
}

function writeReport(context: EvalsCommandContext, report: EvalRunReport) {
  if (context.json) writeJson(context.stdout, report);
  else if (option(context.options, "markdown") === true)
    writeText(context.stdout, formatReportMarkdown(report));
  else writeText(context.stdout, formatReportText(report));
}

export async function runEvalsCommand(
  context: EvalsCommandContext,
): Promise<void> {
  const subcommand = validate(context);
  const { client, stdout, json = false } = context;
  if (subcommand === "cases") {
    const cases = data<
      {
        id: string;
        suite: string;
        area: string;
        title: string;
        requires: string | null;
      }[]
    >(await client.get("/v1/admin/evals/cases", context.signal));
    if (json) writeJson(stdout, cases);
    else
      writeText(
        stdout,
        cases.map(
          (evalCase) =>
            `${evalCase.suite.padEnd(8)} ${evalCase.area.padEnd(18)} ${evalCase.id}${evalCase.requires ? ` (needs ${evalCase.requires})` : ""}`,
        ),
      );
    return;
  }
  if (subcommand === "list") {
    const limit = optionString(context.options, "limit") ?? "20";
    const runs = data<
      (EvalRun & {
        scores: Record<
          string,
          { passed: number; scored: number; open: number }
        >;
        costUsd: number;
      })[]
    >(
      await client.get(
        `/v1/admin/evals/runs?limit=${encodeURIComponent(limit)}`,
        context.signal,
      ),
    );
    if (json) writeJson(stdout, runs);
    else
      writeText(
        stdout,
        runs.map(
          (run) =>
            `${run.createdAt} ${run.trigger.toLowerCase().padEnd(6)} ${run.status.toLowerCase().padEnd(9)} ${runRef(run).padEnd(9)} ${Object.entries(
              run.scores,
            )
              .map(
                ([suite, score]) =>
                  `${suite} ${score.passed}/${score.scored}${score.open ? ` (+${score.open})` : ""}`,
              )
              .join("  ")}  $${run.costUsd.toFixed(2)}  ${run.id}`,
        ),
      );
    return;
  }
  if (subcommand === "show") {
    const report = data<EvalRunReport>(
      await client.get(
        `/v1/admin/evals/runs/${encodeURIComponent(context.positionalId ?? "")}`,
        context.signal,
      ),
    );
    writeReport(context, report);
    return;
  }
  const run = data<EvalRun>(
    await client.post(
      "/v1/admin/evals/runs",
      runBody(context.options),
      context.signal,
    ),
  );
  if (option(context.options, "wait") !== true) {
    if (json) writeJson(stdout, run);
    else
      writeText(stdout, [
        `Started eval run ${run.id} (${run.status.toLowerCase()}), ${run.repeats} ${run.repeats === 1 ? "repeat" : "repeats"}.`,
        `Follow it with sokosumi evals show ${run.id}, or add --wait.`,
      ]);
    return;
  }
  if (!json) writeText(stdout, [`Started eval run ${run.id}. Waiting for it…`]);
  writeReport(context, await waitForRun(client, run.id, context));
}

/**
 * Scores the route classifier on labelled owner messages (`scripts/jev-routing-bench.mts`).
 *
 * A case names the outcome its turn should get, on the scale the bot feels:
 * ASK (CLARIFY: reads only, and the bot asks), READ (DIRECT_RESPONSE: reads
 * only, the bot answers), DELEGATE (Task work, all work writes), HIRE, or
 * MANAGE:<scope> for one kind of change. ACT accepts any write outcome but a
 * hire, for requests whose single scope is a matter of taste. The outcome is
 * read from the final classification, so thresholds and fallbacks count.
 */
import {
  SOKO_BOT_TURN_COMPLEXITIES,
  type SokoBotTurnComplexity,
  type TurnClassification,
} from "@sokosumi/soko-bot";
import { z } from "zod";

const SCOPES = [
  "WORK",
  "SCHEDULE",
  "SOCIAL",
  "ADS",
  "CHAT",
  "FILE",
  "INTEGRATION",
  "MEMORY",
] as const;
const outcomeSchema = z.union([
  z.enum(["ASK", "READ", "DELEGATE", "HIRE", "ACT"]),
  z.templateLiteral(["MANAGE:", z.enum(SCOPES)]),
]);
export type RoutingOutcome = z.infer<typeof outcomeSchema>;

export const ROUTING_CATEGORIES = [
  "read",
  "ask",
  "delegate",
  "hire",
  "schedule",
  "social",
  "ads",
  "work",
  "chat",
  "memory",
  "file",
  "integration",
  "multi",
] as const;

export const routingCaseSchema = z.object({
  id: z.string().min(1),
  category: z.enum(ROUTING_CATEGORIES),
  lang: z.enum(["en", "de"]),
  bot: z.enum(["soko-bot", "cuso"]),
  message: z.string().min(1),
  previousReply: z.string().min(1).optional(),
  want: outcomeSchema,
  alt: z.array(outcomeSchema).optional(),
  complexity: z.enum(SOKO_BOT_TURN_COMPLEXITIES),
  source: z.string().min(1),
});
export type RoutingCase = z.infer<typeof routingCaseSchema>;

export function parseRoutingCases(raw: unknown): RoutingCase[] {
  const cases = z.array(routingCaseSchema).parse(raw);
  const ids = new Set<string>();
  for (const item of cases) {
    if (ids.has(item.id)) throw new Error(`Duplicate case id ${item.id}`);
    ids.add(item.id);
  }
  return cases;
}

export type GotOutcome = Exclude<RoutingOutcome, "ACT">;

export function outcomeOf(classification: TurnClassification): GotOutcome {
  switch (classification.route) {
    case "CLARIFY":
      return "ASK";
    case "DIRECT_RESPONSE":
      return "READ";
    case "HIRE_AGENT":
      return "HIRE";
    case "DELEGATE_TASK":
    case "MIXED":
      return "DELEGATE";
    case "MANAGE_WORK":
      return classification.writeScope
        ? `MANAGE:${classification.writeScope}`
        : "READ";
  }
}

export function acts(outcome: RoutingOutcome): boolean {
  return outcome !== "ASK" && outcome !== "READ";
}

export function isRight(item: RoutingCase, got: GotOutcome): boolean {
  if (got === item.want || item.alt?.includes(got)) return true;
  return item.want === "ACT" && acts(got) && got !== "HIRE";
}

/** Right about whether to act at all, the error the owner feels most. */
export function isRightToAct(item: RoutingCase, got: GotOutcome): boolean {
  return isRight(item, got) || acts(got) === acts(item.want);
}

type Kind = "ASK" | "READ" | "DELEGATE" | "HIRE" | "MANAGE" | "ACT";
const kindOf = (outcome: RoutingOutcome): Kind =>
  outcome.startsWith("MANAGE:") ? "MANAGE" : (outcome as Kind);

export interface RoutingCall {
  caseId: string;
  run: number;
  got: GotOutcome | null;
  /** Jev's own top route and its probability, before any threshold. */
  jevRoute: string | null;
  jevConfidence: number | null;
  /** Set when Jev leaned to an acting route below its bar: reads only. */
  unsureRoute: string | null;
  complexity: SokoBotTurnComplexity["label"] | null;
  costUsd: number;
}

interface Tally {
  n: number;
  right: number;
  rightToAct: number;
}
const tally = (): Tally => ({ n: 0, right: 0, rightToAct: 0 });
const pct = (part: number, whole: number) =>
  whole ? `${Math.round((part / whole) * 100)}%` : "–";

export interface RoutingSummary {
  calls: number;
  failed: number;
  costUsd: number;
  right: number;
  rightToAct: number;
  /** Should act, got reads only. */
  underActs: number;
  /** Should not act, acted. */
  overActs: number;
  hireOverGrants: number;
  /** Lost to a threshold: Jev's top route acted, the outcome did not. */
  lostToThreshold: number;
  /** Cases whose outcome differed between runs. */
  flipped: number;
  complexityRight: number;
  complexityAnswered: number;
  groups: Record<string, Record<string, Tally>>;
  confusion: Record<Kind, Record<Kind | "FAILED", number>>;
  complexityConfusion: Record<string, Record<string, number>>;
}

export function summarizeRouting(
  cases: readonly RoutingCase[],
  calls: readonly RoutingCall[],
): RoutingSummary {
  const byId = new Map(cases.map((item) => [item.id, item]));
  const summary: RoutingSummary = {
    calls: calls.length,
    failed: 0,
    costUsd: 0,
    right: 0,
    rightToAct: 0,
    underActs: 0,
    overActs: 0,
    hireOverGrants: 0,
    lostToThreshold: 0,
    flipped: 0,
    complexityRight: 0,
    complexityAnswered: 0,
    groups: {},
    confusion: {} as RoutingSummary["confusion"],
    complexityConfusion: {},
  };
  const add = (group: string, key: string, right: boolean, toAct: boolean) => {
    summary.groups[group] ??= {};
    const row = (summary.groups[group][key] ??= tally());
    row.n++;
    if (right) row.right++;
    if (toAct) row.rightToAct++;
  };
  const outcomes = new Map<string, Set<string>>();
  for (const call of calls) {
    const item = byId.get(call.caseId);
    if (!item) throw new Error(`Unknown case ${call.caseId}`);
    summary.costUsd += call.costUsd;
    const want = kindOf(item.want);
    summary.confusion[want] ??= {} as Record<Kind | "FAILED", number>;
    const got = call.got;
    const cell = got ? kindOf(got) : "FAILED";
    summary.confusion[want][cell] = (summary.confusion[want][cell] ?? 0) + 1;
    if (!got) {
      summary.failed++;
      continue;
    }
    const seen = outcomes.get(item.id) ?? new Set<string>();
    seen.add(got);
    outcomes.set(item.id, seen);
    const right = isRight(item, got);
    const toAct = isRightToAct(item, got);
    if (right) summary.right++;
    if (toAct) summary.rightToAct++;
    if (!toAct && acts(item.want)) summary.underActs++;
    if (!toAct && !acts(item.want)) summary.overActs++;
    if (got === "HIRE" && !right) summary.hireOverGrants++;
    if (!toAct && acts(item.want) && call.unsureRoute)
      summary.lostToThreshold++;
    add("Wanted", want, right, toAct);
    add("Category", item.category, right, toAct);
    add("Bot", item.bot, right, toAct);
    add("Language", item.lang, right, toAct);
    add("Turn", item.previousReply ? "follow-up" : "first", right, toAct);
    add("Labelled complexity", item.complexity, right, toAct);
    if (call.complexity) {
      summary.complexityAnswered++;
      if (call.complexity === item.complexity) summary.complexityRight++;
      const row = (summary.complexityConfusion[item.complexity] ??= {});
      row[call.complexity] = (row[call.complexity] ?? 0) + 1;
    }
  }
  summary.flipped = [...outcomes.values()].filter((set) => set.size > 1).length;
  return summary;
}

const GOT_KINDS = [
  "ASK",
  "READ",
  "DELEGATE",
  "HIRE",
  "MANAGE",
  "FAILED",
] as const;

export function routingReport(title: string, summary: RoutingSummary): string {
  const answered = summary.calls - summary.failed;
  const lines = [
    `## ${title}`,
    "",
    `| Calls | Right | Right to act or not | Under-acts | Over-acts | Hire over-grants | Lost to a threshold | Complexity right | Flipped cases | Failed | Cost |`,
    "|---|---|---|---|---|---|---|---|---|---|---|",
    `| ${summary.calls} | ${pct(summary.right, answered)} | ${pct(summary.rightToAct, answered)} | ${summary.underActs} | ${summary.overActs} | ${summary.hireOverGrants} | ${summary.lostToThreshold} | ${pct(summary.complexityRight, summary.complexityAnswered)} | ${summary.flipped} | ${summary.failed} | $${summary.costUsd.toFixed(4)} |`,
    "",
  ];
  for (const [group, rows] of Object.entries(summary.groups)) {
    lines.push(
      `| ${group} | n | Right | Right to act or not |`,
      "|---|---|---|---|",
    );
    for (const [key, row] of Object.entries(rows).sort())
      lines.push(
        `| ${key} | ${row.n} | ${pct(row.right, row.n)} | ${pct(row.rightToAct, row.n)} |`,
      );
    lines.push("");
  }
  lines.push(
    `| Wanted \\ got | ${GOT_KINDS.join(" | ")} |`,
    `|---|${GOT_KINDS.map(() => "---").join("|")}|`,
  );
  for (const [want, row] of Object.entries(summary.confusion).sort())
    lines.push(
      `| ${want} | ${GOT_KINDS.map((kind) => row[kind] ?? 0).join(" | ")} |`,
    );
  lines.push(
    "",
    `| Complexity labelled \\ Jev | ${SOKO_BOT_TURN_COMPLEXITIES.join(" | ")} |`,
    `|---|${SOKO_BOT_TURN_COMPLEXITIES.map(() => "---").join("|")}|`,
  );
  for (const label of SOKO_BOT_TURN_COMPLEXITIES) {
    const row = summary.complexityConfusion[label] ?? {};
    lines.push(
      `| ${label} | ${SOKO_BOT_TURN_COMPLEXITIES.map((got) => row[got] ?? 0).join(" | ")} |`,
    );
  }
  return lines.join("\n");
}

/** One line per wrong call, for the dev set only. */
export function routingMisses(
  cases: readonly RoutingCase[],
  calls: readonly RoutingCall[],
): string {
  const byId = new Map(cases.map((item) => [item.id, item]));
  const rows = calls.flatMap((call) => {
    const item = byId.get(call.caseId);
    if (!item || (call.got && isRight(item, call.got))) return [];
    const jev = call.jevRoute
      ? `${call.jevRoute} ${pct(call.jevConfidence ?? 0, 1)}`
      : "–";
    return [
      `| ${item.id} | ${call.run} | ${item.want}${item.alt ? ` (or ${item.alt.join(", ")})` : ""} | ${call.got ?? "FAILED"} | ${jev} | ${item.message.slice(0, 90).replaceAll("|", "/").replaceAll("\n", " ")} |`,
    ];
  });
  return [
    "| Case | Run | Wanted | Got | Jev's top route | Message |",
    "|---|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

/**
 * Prints the full trace of a Soko Bot turn: the turn row, every runtime event
 * in order, and every tool call with its outcome. Core already records all of
 * this durably, but it is only reachable through the admin UI, so diagnosing a
 * production turn meant inferring from timing. This reads it directly.
 *
 *   pnpm --filter core soko-bot:trace -- <turnId>
 *   pnpm --filter core soko-bot:trace -- --last 3
 *   pnpm --filter core soko-bot:trace -- --last 5 --stuck
 *
 * Runs against whatever DATABASE_URL the environment supplies. Read-only.
 */
import prisma from "@/lib/db/prisma";

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
}

const FINAL = ["COMPLETED", "FAILED", "CANCELLED"] as const;
const stuckOnly = args.includes("--stuck");
const lastCount = Number(flag("last") ?? "0");
const turnIdArg = args.find((arg) => !arg.startsWith("--") && arg.length > 20);

function ms(from: Date | null, to: Date | null): string {
  if (!from || !to) return "—";
  return `${((to.getTime() - from.getTime()) / 1000).toFixed(1)}s`;
}

function short(value: unknown, max = 160): string {
  const text =
    typeof value === "string" ? value : JSON.stringify(value ?? null);
  const clean = (text ?? "").replaceAll(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

async function traceTurn(turnId: string): Promise<void> {
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: turnId },
    include: {
      events: { orderBy: { sequence: "asc" } },
      toolCalls: { orderBy: { createdAt: "asc" } },
      delegations: true,
    },
  });
  if (!turn) {
    console.log(`turn ${turnId}: not found`);
    return;
  }

  const runtimeEvents = await prisma.sokoBotRuntimeEvent.findMany({
    where: { turnId },
    orderBy: { startIndex: "asc" },
  });

  console.log("=".repeat(78));
  console.log(`turn      ${turn.id}`);
  console.log(
    `status    ${turn.status}   source=${turn.source}   route=${turn.route ?? "—"}`,
  );
  console.log(
    `version   ${turn.versionId ?? "(default)"}   client=${turn.clientTurnId}`,
  );
  console.log(`created   ${turn.createdAt.toISOString()}`);
  console.log(
    `started   ${turn.startedAt?.toISOString() ?? "—"}   completed ${turn.completedAt?.toISOString() ?? "—"}`,
  );
  console.log(
    `elapsed   ${ms(turn.startedAt ?? turn.createdAt, turn.completedAt ?? new Date())}${turn.completedAt ? "" : "  (still open)"}`,
  );
  if (turn.costUsdMicros) {
    console.log(
      `cost      $${(Number(turn.costUsdMicros) / 1_000_000).toFixed(4)}`,
    );
  }
  if (turn.errorKind || turn.errorDetail) {
    console.log(
      `error     ${turn.errorKind ?? "?"}: ${short(turn.errorDetail, 300)}`,
    );
  }
  console.log(`message   ${short(turn.userMessage, 200)}`);
  console.log(
    `answer    ${turn.finalAnswer ? short(turn.finalAnswer, 200) : "—"}`,
  );

  console.log(`\nruntime events (${runtimeEvents.length}):`);
  if (runtimeEvents.length === 0) {
    console.log(
      "  none — the loop never wrote anything, so it died before or at the first append",
    );
  }
  let previous: Date | null = null;
  for (const event of runtimeEvents) {
    const gap = previous ? ` +${ms(previous, event.occurredAt)}` : "";
    const data = event.data as Record<string, unknown> | null;
    let detail = "";
    if (event.type === "actions.requested") {
      const actions = (data?.actions ?? []) as { name?: string }[];
      detail = actions.map((a) => a.name).join(", ");
    } else if (event.type === "action.result") {
      detail = String(data?.name ?? "");
    } else if (event.type === "step.completed") {
      const usage = data?.usage as Record<string, unknown> | undefined;
      detail = `in=${usage?.inputTokens ?? 0} out=${usage?.outputTokens ?? 0} $${usage?.costUsd ?? 0}`;
    } else if (event.type === "turn.failed") {
      detail = `${data?.code ?? ""}: ${short(data?.message, 200)}`;
    }
    console.log(
      `  ${String(event.startIndex).padStart(3)} ${event.occurredAt.toISOString().slice(11, 23)}${gap.padStart(9)}  ${event.type.padEnd(20)} ${detail}`,
    );
    previous = event.occurredAt;
  }

  // A requested action with no matching result is the tool the turn stopped on.
  const requested = runtimeEvents.filter(
    (e) => e.type === "actions.requested",
  ).length;
  const resulted = runtimeEvents.filter(
    (e) => e.type === "action.result",
  ).length;
  // `action.result` is appended only on success, so a request without one is
  // either a tool that failed — its error is listed below — or one that never
  // came back at all, which is what a hung turn looks like.
  const failedCalls = turn.toolCalls.filter(
    (call) => call.status === "FAILED",
  ).length;
  const unaccounted = requested - resulted - failedCalls;
  if (unaccounted > 0) {
    console.log(
      `\n  >>> ${unaccounted} tool call(s) neither returned nor failed — that is a hang`,
    );
  } else if (requested > resulted) {
    console.log(
      `\n  >>> ${requested - resulted} tool call(s) failed; errors below`,
    );
  }

  console.log(`\ntool calls (${turn.toolCalls.length}):`);
  for (const call of turn.toolCalls) {
    console.log(
      `  ${call.capability.padEnd(24)} ${call.status.padEnd(10)} ${call.errorKind ?? ""} ${short(call.errorDetail ?? call.result, 120)}`,
    );
  }
  if (turn.delegations.length > 0) {
    console.log(`\ndelegations (${turn.delegations.length}):`);
    for (const d of turn.delegations) {
      console.log(
        `  ${d.action ?? "?"} task=${d.taskId ?? "—"} job=${d.jobId ?? "—"} outcome=${d.outcome ?? "—"}`,
      );
    }
  }
}

if (turnIdArg) {
  await traceTurn(turnIdArg);
} else {
  const turns = await prisma.sokoBotTurn.findMany({
    where: stuckOnly ? { status: { notIn: [...FINAL] } } : {},
    orderBy: { createdAt: "desc" },
    take: Math.max(1, lastCount || 3),
    select: { id: true },
  });
  if (turns.length === 0) console.log("no turns matched");
  for (const turn of turns) await traceTurn(turn.id);
}

await prisma.$disconnect();

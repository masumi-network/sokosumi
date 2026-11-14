import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma } from "@sokosumi/database";
import { z } from "zod";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  currentEvaluationActor,
  withEvaluationActor,
} from "@/lib/soko-bot/evaluation-dispatch";
import { evalEnvironment } from "./eval-environment";

export const MAILBOX_FIXTURE_CASES = [
  "inbox-summary",
  "calendar-prep",
  "standup-with-inbox",
  "mail-delta",
  "quiet-standup",
  "quiet-delta",
  "autonomous-meeting-prep",
] as const;
const ACTIVE_RESULTS = ["PENDING", "RUNNING"] as const;
const ACTIVE_TURNS = ["QUEUED", "STARTING", "RUNNING"] as const;
const FIXTURE_LIFETIME_MS = 30 * 60_000;
const CLOCK_SKEW_MS = 1_000;
const CLIENT_PREFIX = "lab:eval:";
const bindingSchema = z
  .object({
    version: z.literal(1),
    resultId: z.uuid(),
    runId: z.uuid(),
    caseId: z.enum(MAILBOX_FIXTURE_CASES),
    repeat: z.number().int().min(1).max(3),
    referenceTime: z.iso.datetime(),
    userId: z.string().min(1),
    organizationId: z.string().min(1),
    workspaceId: z.uuid(),
    sokoBotId: z.uuid(),
    clientTurnId: z.string().min(1),
    source: z.enum(["CHAT", "SCHEDULE", "INGEST"]),
  })
  .strict();
export type MailboxFixtureBinding = z.infer<typeof bindingSchema>;
const preparing = new AsyncLocalStorage<string>();

const resultSelect = {
  id: true,
  runId: true,
  caseId: true,
  repeat: true,
  suite: true,
  status: true,
  state: true,
  turnId: true,
  run: { select: { status: true, environment: true } },
} as const satisfies Prisma.EvalResultSelect;
type FixtureResult = Prisma.EvalResultGetPayload<{
  select: typeof resultSelect;
}>;

export function mailboxFixtureSource(
  caseId: string,
): MailboxFixtureBinding["source"] {
  if (caseId === "mail-delta" || caseId === "quiet-delta") return "INGEST";
  if (
    ["standup-with-inbox", "quiet-standup", "autonomous-meeting-prep"].includes(
      caseId,
    )
  )
    return "SCHEDULE";
  return "CHAT";
}

function stateObject(state: unknown): Record<string, unknown> {
  return state && typeof state === "object" && !Array.isArray(state)
    ? (state as Record<string, unknown>)
    : {};
}

async function validateBinding(
  binding: MailboxFixtureBinding,
  result: FixtureResult,
  tx: Prisma.TransactionClient,
) {
  if (
    result.id !== binding.resultId ||
    result.runId !== binding.runId ||
    result.caseId !== binding.caseId ||
    result.repeat !== binding.repeat ||
    result.suite !== "soko-bot" ||
    !ACTIVE_RESULTS.includes(
      result.status as (typeof ACTIVE_RESULTS)[number],
    ) ||
    result.run.status !== "RUNNING" ||
    !["preview", "local"].includes(result.run.environment) ||
    result.run.environment !== evalEnvironment() ||
    binding.clientTurnId !== `${CLIENT_PREFIX}${binding.resultId}` ||
    binding.source !== mailboxFixtureSource(binding.caseId) ||
    Date.now() - Date.parse(binding.referenceTime) > FIXTURE_LIFETIME_MS ||
    Date.parse(binding.referenceTime) > Date.now() + CLOCK_SKEW_MS
  )
    throw new Error("Mailbox fixture binding unavailable");
  const lane = await tx.evalLane.findUnique({
    where: { lane: binding.repeat },
  });
  if (
    !lane ||
    lane.userId !== binding.userId ||
    lane.organizationId !== binding.organizationId ||
    lane.workspaceId !== binding.workspaceId ||
    lane.sokoBotId !== binding.sokoBotId
  )
    throw new Error("Mailbox fixture lane denied");
  const bot = await tx.sokoBot.findFirst({
    where: {
      id: binding.sokoBotId,
      userId: binding.userId,
      workspaceId: binding.workspaceId,
      proactivePaused: true,
      archivedAt: null,
      deletedAt: null,
    },
    select: { id: true },
  });
  const workspace = await tx.workspace.findFirst({
    where: { id: binding.workspaceId, organizationId: binding.organizationId },
    select: { id: true },
  });
  const organization = await tx.organization.findFirst({
    where: {
      id: binding.organizationId,
      slug: `sokosumi-evals-${binding.repeat}`,
    },
    select: { id: true },
  });
  if (!bot || !workspace || !organization)
    throw new Error("Mailbox fixture ownership denied");
}

/** Persist before packet construction. Retries keep the first committed clock. */
export async function prepareMailboxFixture(input: {
  resultId: string;
  caseId: string;
  referenceTime: Date;
  lane: {
    lane: number;
    userId: string;
    organizationId: string;
    workspaceId: string;
    sokoBotId: string;
  };
}): Promise<MailboxFixtureBinding | null> {
  if (!MAILBOX_FIXTURE_CASES.some((id) => id === input.caseId)) return null;
  return serializableTransaction(async (tx) => {
    const result = await tx.evalResult.findUniqueOrThrow({
      where: { id: input.resultId },
      select: resultSelect,
    });
    if (!["preview", "local"].includes(result.run.environment)) return null;
    const state = stateObject(result.state);
    const existing = state.mailboxFixture;
    const binding = bindingSchema.parse(
      existing ?? {
        version: 1,
        resultId: input.resultId,
        runId: result.runId,
        caseId: input.caseId,
        repeat: input.lane.lane,
        referenceTime: input.referenceTime.toISOString(),
        userId: input.lane.userId,
        organizationId: input.lane.organizationId,
        workspaceId: input.lane.workspaceId,
        sokoBotId: input.lane.sokoBotId,
        clientTurnId: `${CLIENT_PREFIX}${input.resultId}`,
        source: mailboxFixtureSource(input.caseId),
      },
    );
    await validateBinding(binding, result, tx);
    if (
      binding.caseId !== input.caseId ||
      binding.userId !== input.lane.userId ||
      binding.workspaceId !== input.lane.workspaceId ||
      binding.sokoBotId !== input.lane.sokoBotId
    )
      throw new Error("Mailbox fixture preparation mismatch");
    await tx.evalResult.update({
      where: { id: result.id },
      data: {
        state: { ...state, mailboxFixture: binding } as Prisma.InputJsonValue,
      },
    });
    return binding;
  }, "Concurrent mailbox fixture preparation");
}

export function withMailboxFixturePreparation<T>(
  binding: MailboxFixtureBinding,
  run: () => T,
): T {
  return preparing.run(binding.resultId, () =>
    withEvaluationActor(
      {
        userId: binding.userId,
        sokoBotId: binding.sokoBotId,
        clientTurnId: binding.clientTurnId,
        source: binding.source,
      },
      run,
    ),
  );
}

/** No process-global fixture mode. Every read rechecks the persisted lane and result. */
export async function currentMailboxFixture(
  sokoBotId?: string,
): Promise<MailboxFixtureBinding | null> {
  const actor = currentEvaluationActor();
  if (!actor?.clientTurnId.startsWith(CLIENT_PREFIX)) return null;
  const resultId = actor.clientTurnId.slice(CLIENT_PREFIX.length);
  if (!z.uuid().safeParse(resultId).success)
    throw new Error("Evaluation result identity invalid");
  const result = await prisma.evalResult.findUnique({
    where: { id: resultId },
    select: resultSelect,
  });
  if (!result) throw new Error("Evaluation result unavailable");
  if (!MAILBOX_FIXTURE_CASES.some((id) => id === result.caseId)) {
    if (stateObject(result.state).mailboxFixture !== undefined)
      throw new Error("Mailbox fixture case mismatch");
    return null;
  }
  const binding = bindingSchema.parse(stateObject(result.state).mailboxFixture);
  await validateBinding(binding, result, prisma);
  if (
    actor.userId !== binding.userId ||
    actor.sokoBotId !== binding.sokoBotId ||
    actor.clientTurnId !== binding.clientTurnId ||
    actor.source !== binding.source ||
    (sokoBotId !== undefined && sokoBotId !== binding.sokoBotId)
  )
    throw new Error("Mailbox fixture actor denied");
  const turn = await prisma.sokoBotTurn.findFirst({
    where: { sokoBotId: binding.sokoBotId, clientTurnId: binding.clientTurnId },
    select: {
      id: true,
      workspaceId: true,
      requestedByUserId: true,
      source: true,
      status: true,
    },
  });
  if (!turn) {
    if (
      result.status !== "PENDING" ||
      preparing.getStore() !== binding.resultId
    )
      throw new Error("Mailbox fixture turn missing");
  } else if (
    turn.workspaceId !== binding.workspaceId ||
    turn.source !== binding.source ||
    (turn.requestedByUserId !== null &&
      turn.requestedByUserId !== binding.userId) ||
    !ACTIVE_TURNS.includes(turn.status as (typeof ACTIVE_TURNS)[number]) ||
    (result.status === "RUNNING" && result.turnId !== turn.id) ||
    (result.turnId !== null && result.turnId !== turn.id)
  )
    throw new Error("Mailbox fixture turn denied");
  return binding;
}

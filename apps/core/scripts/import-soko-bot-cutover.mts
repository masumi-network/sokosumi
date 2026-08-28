/**
 * Validate and optionally import final external Hermes schedule export.
 * Dry-run is default. Apply only after reviewing report and freezing source.
 *
 * pnpm --filter core soko-bot:import-cutover -- ./hermes-schedules.json
 * pnpm --filter core soko-bot:import-cutover -- ./hermes-schedules.json --apply --confirm-source-frozen
 * pnpm --filter core soko-bot:import-cutover -- ./empty.json --confirm-empty
 */
import { readFile } from "node:fs/promises";

import { createPrismaClient } from "@sokosumi/database/client";
import { z } from "zod";

import { computeNextRunWithMinimumInterval } from "../src/helpers/cron.js";

const exportSchema = z
  .object({
    version: z.literal(1),
    generatedAt: z.string().datetime(),
    schedules: z.array(
      z
        .object({
          id: z.string().min(1).max(240),
          userId: z.string().min(1),
          workspaceId: z.string().uuid(),
          name: z.string().trim().min(1).max(120),
          timezone: z.string().trim().min(1).max(100),
          cronExpression: z.string().trim().min(1).max(120),
          prompt: z.string().trim().min(1).max(20_000),
          enabled: z.boolean().default(true),
        })
        .strict(),
    ),
  })
  .strict();

interface ImportReportItem {
  id: string;
  status: "ready" | "invalid" | "imported";
  reason?: string;
}

interface PreparedImport {
  schedule: z.infer<typeof exportSchema>["schedules"][number];
  sokoBotId: string;
  nextRunAt: Date;
}

const args = process.argv.slice(2);
const supportedFlags = new Set([
  "--apply",
  "--confirm-empty",
  "--confirm-source-frozen",
]);
const unknownFlag = args.find(
  (arg) => arg.startsWith("--") && !supportedFlags.has(arg),
);
if (unknownFlag) throw new Error(`Unknown option: ${unknownFlag}`);
const inputPath = args.find((arg) => !arg.startsWith("--"));
const apply = args.includes("--apply");
const confirmEmpty = args.includes("--confirm-empty");
const confirmSourceFrozen = args.includes("--confirm-source-frozen");
if (!inputPath) throw new Error("Path to Hermes schedule export is required");
if (apply && !confirmSourceFrozen) {
  throw new Error("--apply requires --confirm-source-frozen");
}
if (!apply && confirmSourceFrozen) {
  throw new Error("--confirm-source-frozen is only valid with --apply");
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const parsed = exportSchema.parse(
  JSON.parse(await readFile(inputPath, "utf8")),
);
if (parsed.schedules.length === 0 && !confirmEmpty) {
  throw new Error(
    "Empty export requires --confirm-empty so missing source data cannot silently pass cutover",
  );
}

const prisma = createPrismaClient(databaseUrl);
const report: ImportReportItem[] = [];
const prepared: PreparedImport[] = [];
const sourceIds = new Set<string>();
try {
  for (const schedule of parsed.schedules) {
    if (sourceIds.has(schedule.id)) {
      report.push({
        id: schedule.id,
        status: "invalid",
        reason: "Duplicate schedule id in source export",
      });
      continue;
    }
    sourceIds.add(schedule.id);

    const [bot, workspace, existing] = await Promise.all([
      prisma.sokoBot.findFirst({
        where: { userId: schedule.userId, archivedAt: null },
        select: { id: true },
      }),
      prisma.workspace.findFirst({
        where: {
          id: schedule.workspaceId,
          OR: [
            { userId: schedule.userId },
            {
              organization: {
                members: { some: { userId: schedule.userId } },
              },
            },
          ],
        },
        select: { id: true },
      }),
      prisma.sokoBotSchedule.findUnique({
        where: { legacyScheduleId: schedule.id },
        select: { sokoBotId: true, userId: true, workspaceId: true },
      }),
    ]);
    const nextRunAt = computeNextRunWithMinimumInterval(
      {
        cron: schedule.cronExpression,
        timezone: schedule.timezone,
        from: new Date(),
      },
      60_000,
    );
    const reason = !bot
      ? "Soko Bot not found"
      : !workspace
        ? "Workspace not accessible by user"
        : existing &&
            (existing.sokoBotId !== bot.id ||
              existing.userId !== schedule.userId ||
              existing.workspaceId !== schedule.workspaceId)
          ? "Legacy schedule id already belongs to a different target"
          : !nextRunAt
            ? "Invalid cron/timezone or interval below one minute"
            : null;
    if (reason || !bot || !nextRunAt) {
      report.push({
        id: schedule.id,
        status: "invalid",
        reason: reason ?? "invalid",
      });
      continue;
    }
    prepared.push({ schedule, sokoBotId: bot.id, nextRunAt });
    report.push({
      id: schedule.id,
      status: "ready",
    });
  }

  const hasInvalid = report.some((item) => item.status === "invalid");
  if (apply && !hasInvalid) {
    await prisma.$transaction(
      async (tx) => {
        for (const item of prepared) {
          const { schedule, sokoBotId, nextRunAt } = item;
          const existing = await tx.sokoBotSchedule.findUnique({
            where: { legacyScheduleId: schedule.id },
            select: { sokoBotId: true, userId: true, workspaceId: true },
          });
          if (
            existing &&
            (existing.sokoBotId !== sokoBotId ||
              existing.userId !== schedule.userId ||
              existing.workspaceId !== schedule.workspaceId)
          ) {
            throw new Error(
              `Schedule ${schedule.id} target changed after validation`,
            );
          }
          await tx.sokoBotSchedule.upsert({
            where: { legacyScheduleId: schedule.id },
            create: {
              sokoBotId,
              userId: schedule.userId,
              workspaceId: schedule.workspaceId,
              name: schedule.name,
              enabled: schedule.enabled,
              timezone: schedule.timezone,
              cronExpression: schedule.cronExpression,
              prompt: schedule.prompt,
              legacyScheduleId: schedule.id,
              nextRunAt,
            },
            update: {
              name: schedule.name,
              enabled: schedule.enabled,
              timezone: schedule.timezone,
              cronExpression: schedule.cronExpression,
              prompt: schedule.prompt,
              nextRunAt,
            },
          });
        }
      },
      { isolationLevel: "Serializable", maxWait: 10_000, timeout: 120_000 },
    );
    for (const item of report) item.status = "imported";
  }
} finally {
  await prisma.$disconnect();
}

const invalid = report.filter((item) => item.status === "invalid");
console.log(
  JSON.stringify(
    {
      sourceVersion: parsed.version,
      sourceGeneratedAt: parsed.generatedAt,
      mode: apply ? "apply" : "dry-run",
      sourceFrozenConfirmed: apply && confirmSourceFrozen,
      applied: apply && invalid.length === 0,
      emptyExportConfirmed: parsed.schedules.length === 0 && confirmEmpty,
      total: report.length,
      readyOrImported: report.length - invalid.length,
      invalid: invalid.length,
      items: report,
    },
    null,
    2,
  ),
);
if (invalid.length > 0) process.exitCode = 1;

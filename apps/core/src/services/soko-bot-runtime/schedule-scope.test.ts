import type { Prisma } from "@sokosumi/database";
import {
  bindScheduleStopRule,
  type OwnerAuthority,
  OwnerAuthorityError,
} from "@sokosumi/soko-bot";
import { SokosumiJobStatus } from "@sokosumi/utils";
import { describe, expect, it, vi } from "vitest";
import type { NetworkScope } from "@/lib/db/network-scope";

import {
  attenuateForChildWork,
  mintTurnOwnerAuthority,
} from "@/lib/soko-bot/owner-authority";
import {
  disableScheduleIfCountLimitMet,
  recordCompletedScheduleRun,
  updateSokoBotSchedule,
} from "@/services/soko-bot-schedule.service";
import {
  requireScheduledRunMayEnd,
  resolveBotScheduleAuthority,
  resolveRequestedScheduleCapabilities,
  resolveUiScheduleAuthority,
} from "./schedule-scope";

const OWN = "01960001-0001-7001-8001-000000000001";
const OTHER = "01960001-0001-7001-8001-000000000002";
const BOT_ID = "01960001-0001-7001-8001-0000000000b0";
const WORKSPACE_ID = "01960001-0001-7001-8001-0000000000w0";
const PROJECT_ID = "01960001-0001-7001-8001-0000000000p0";
const OWNER_ID = "user_owner_1";
const TEAMMATE_ID = "user_teammate_2";
const ROOT_TURN_ID = "01960001-0001-7001-8001-0000000000t0";
const LATER_TURN_ID = "01960001-0001-7001-8001-0000000000t1";

function tx(prompt: string | null) {
  return {
    sokoBotScheduleRun: {
      findUnique: vi.fn().mockResolvedValue(
        prompt === null
          ? null
          : {
              id: "run-1",
              status: "CLAIMED",
              schedule: {
                id: OWN,
                name: "Weekly report",
                prompt,
                sokoBotId: BOT_ID,
                workspaceId: WORKSPACE_ID,
                completedRuns: 0,
                authority: null,
                sokoBot: {
                  userId: OWNER_ID,
                  archivedAt: null,
                  status: "RUNNING",
                  adminPausedAt: null,
                  projectId: null,
                  versionId: "v36",
                },
              },
            },
      ),
    },
    workspace: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: WORKSPACE_ID, organizationId: "org-1" }),
    },
    task: { findFirst: vi.fn().mockResolvedValue(null) },
  } as unknown as Prisma.TransactionClient;
}

function authorityTx(options: {
  prompt?: string;
  authority: unknown;
  runStatus?: string;
  completedRuns?: number;
  taskStatus?: string | null;
  grantorWorkspace?: { id: string; organizationId: string | null } | null;
  bot?: Partial<{
    userId: string | null;
    archivedAt: Date | null;
    status: string;
    adminPausedAt: Date | null;
    projectId: string | null;
    versionId: string | null;
  }> | null;
}) {
  const defaultBot = {
    userId: OWNER_ID as string | null,
    archivedAt: null as Date | null,
    status: "RUNNING",
    adminPausedAt: null as Date | null,
    projectId: null as string | null,
    versionId: "v36" as string | null,
  };
  return {
    sokoBotScheduleRun: {
      findUnique: vi.fn().mockResolvedValue({
        id: "run-1",
        status: options.runStatus ?? "CLAIMED",
        schedule: {
          id: OWN,
          name: "Weekly report",
          prompt:
            options.prompt ??
            "Vérifie l'avancement du projet chaque lundi matin.",
          sokoBotId: BOT_ID,
          workspaceId: WORKSPACE_ID,
          completedRuns: options.completedRuns ?? 0,
          authority: options.authority,
          sokoBot:
            options.bot === null ? null : { ...defaultBot, ...options.bot },
        },
      }),
    },
    workspace: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          "grantorWorkspace" in options
            ? options.grantorWorkspace
            : { id: WORKSPACE_ID, organizationId: null },
        ),
    },
    task: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          options.taskStatus ? { status: options.taskStatus } : null,
        ),
    },
  } as unknown as Prisma.TransactionClient;
}

function scheduleAuthority(
  overrides: {
    stopRule?: Parameters<typeof attenuateForChildWork>[2]["stopRule"];
    expiresAt?: string;
    projectId?: string | null;
    versionId?: string | null;
    allowScheduledPosts?: boolean;
    limits?: { images?: number; maxMediaCredits?: number };
    sharedBot?: boolean;
  } = {},
): OwnerAuthority {
  const versionId = overrides.versionId ?? "v36";
  const isCmo = versionId.startsWith("cmo-");
  const parent = mintTurnOwnerAuthority({
    turn: {
      id: ROOT_TURN_ID,
      sokoBotId: BOT_ID,
      workspaceId: WORKSPACE_ID,
      versionId,
      source: "CHAT",
      parentTurnId: null,
      chainDepth: 0,
      askedByUserId: OWNER_ID,
      requestedByUserId: OWNER_ID,
    },
    actingUserId: OWNER_ID,
    askedByKind: isCmo && overrides.sharedBot ? "TEAMMATE" : "OWNER",
    targetScope: overrides.projectId
      ? { kind: "project", projectId: overrides.projectId }
      : { kind: "workspace" },
    limits: overrides.limits,
    expiresAt: overrides.expiresAt,
  });
  return attenuateForChildWork(parent, "schedule", {
    versionId,
    scheduleId: OWN,
    scheduleEdit: {
      kind: "owner_chat",
      actorUserId: OWNER_ID,
      sokoBotId: BOT_ID,
      workspaceId: WORKSPACE_ID,
      turnId: ROOT_TURN_ID,
      source: "CHAT",
      parentTurnId: null,
      chainDepth: 0,
      askedByKind: isCmo && overrides.sharedBot ? "TEAMMATE" : "OWNER",
      allowWorkspaceMember: Boolean(isCmo && overrides.sharedBot),
    },
    stopRule: overrides.stopRule,
    allowScheduledPosts: overrides.allowScheduledPosts,
  });
}

function authorizedTurn(
  overrides: Partial<{
    id: string;
    source: string | null;
    parentTurnId: string | null;
    chainDepth: number;
    actingUserId: string | null;
    requestedByUserId: string | null;
    askedByUserId: string | null;
    askedByKind: "OWNER" | "TEAMMATE" | "ASSISTANT" | undefined;
    versionId: string | null;
    botProjectId: string | null;
  }> = {},
) {
  return {
    scope: { network: "mainnet" } as NetworkScope,
    askedByKind:
      "askedByKind" in overrides ? overrides.askedByKind : ("OWNER" as const),
    grant: {
      capabilities: ["delete_schedule", "update_schedule"] as const,
    },
    turn: {
      id: overrides.id ?? ROOT_TURN_ID,
      sokoBotId: BOT_ID,
      workspaceId: WORKSPACE_ID,
      actingUserId:
        "actingUserId" in overrides
          ? (overrides.actingUserId ?? null)
          : OWNER_ID,
      requestedByUserId:
        "requestedByUserId" in overrides
          ? (overrides.requestedByUserId ?? null)
          : OWNER_ID,
      askedByUserId:
        "askedByUserId" in overrides
          ? (overrides.askedByUserId ?? null)
          : OWNER_ID,
      parentTurnId: overrides.parentTurnId ?? null,
      botProjectId: overrides.botProjectId ?? null,
      eveSessionId: "sess-1",
      versionId: overrides.versionId ?? "v36",
      modelId: null,
      source: "source" in overrides ? (overrides.source ?? null) : "CHAT",
      chainDepth: overrides.chainDepth ?? 0,
      intentId: null,
      intentRevision: 0,
    },
  };
}

describe("requireScheduledRunMayEnd", () => {
  const refused = /doesn't delete or switch off schedules/;

  it("refuses a run that deletes its own schedule when its brief never asked", async () => {
    await expect(
      requireScheduledRunMayEnd(
        tx("Every Friday: summarize the week's Tasks and post the report."),
        "turn-1",
        "delete_schedule",
        { scheduleId: OWN },
      ),
    ).rejects.toThrow(refused);
  });

  it("keeps a legacy null-authority schedule running even when its prompt asks to end, until an owner binds a typed stopRule", async () => {
    const legacyPrompt =
      "Check SOK-12. Delete this schedule once Mira is done.";
    await expect(
      requireScheduledRunMayEnd(tx(legacyPrompt), "turn-1", "delete_schedule", {
        scheduleId: OWN,
      }),
    ).rejects.toThrow(refused);

    // After a direct owner edit binds a typed stop rule on that legacy row,
    // execution obeys the typed stop rule.
    const optedIn = resolveUiScheduleAuthority(OWNER_ID, {
      mode: "ends_on",
      endsOn: "2026-11-26T00:00:00.000Z",
    })({
      scheduleId: OWN,
      sokoBotId: BOT_ID,
      workspaceId: WORKSPACE_ID,
      existingAuthority: null,
      botProjectId: null,
      botVersionId: "v36",
      sharedBot: false,
    });
    await expect(
      requireScheduledRunMayEnd(
        authorityTx({ prompt: legacyPrompt, authority: optedIn }),
        "turn-1",
        "delete_schedule",
        { scheduleId: OWN },
        undefined,
        { now: new Date("2026-11-26T00:00:00.000Z") },
      ),
    ).resolves.toBeUndefined();
  });

  it("never lets a run delete or switch off another schedule", async () => {
    const due = scheduleAuthority({
      stopRule: { mode: "ends_on", endsOn: "2026-11-01T00:00:00.000Z" },
    });
    await expect(
      requireScheduledRunMayEnd(
        authorityTx({ authority: due }),
        "turn-1",
        "delete_schedule",
        { scheduleId: OTHER },
      ),
    ).rejects.toThrow(refused);
    await expect(
      requireScheduledRunMayEnd(
        authorityTx({ authority: due }),
        "turn-1",
        "update_schedule",
        { scheduleId: OTHER, enabled: false },
      ),
    ).rejects.toThrow(refused);
  });

  it("leaves other changes and turns without a run to the existing rules", async () => {
    await expect(
      requireScheduledRunMayEnd(
        tx("Every Friday: post the report."),
        "turn-1",
        "update_schedule",
        { scheduleId: OWN, cronExpression: "0 9 * * 5" },
      ),
    ).resolves.toBeUndefined();
    await expect(
      requireScheduledRunMayEnd(tx(null), "turn-1", "delete_schedule", {
        scheduleId: OWN,
      }),
    ).rejects.toThrow(refused);
  });

  describe("persisted OwnerAuthority stop rules", () => {
    it("overrides English stop wording when persisted stopRule is never", async () => {
      const authority = scheduleAuthority({ stopRule: { mode: "never" } });
      await expect(
        requireScheduledRunMayEnd(
          authorityTx({
            prompt: "Check SOK-12. Delete this schedule once Mira is done.",
            authority,
          }),
          "turn-1",
          "delete_schedule",
          { scheduleId: OWN },
        ),
      ).rejects.toThrow(refused);
    });

    it("enforces ends_on regardless of prompt language", async () => {
      const authority = scheduleAuthority({
        stopRule: { mode: "ends_on", endsOn: "2026-12-01T00:00:00.000Z" },
      });
      await expect(
        requireScheduledRunMayEnd(
          authorityTx({ authority }),
          "turn-1",
          "delete_schedule",
          { scheduleId: OWN },
          undefined,
          { now: new Date("2026-11-30T23:59:59.000Z") },
        ),
      ).rejects.toThrow(refused);
      await expect(
        requireScheduledRunMayEnd(
          authorityTx({ authority }),
          "turn-1",
          "delete_schedule",
          { scheduleId: OWN },
          undefined,
          { now: new Date("2026-12-01T00:00:00.000Z") },
        ),
      ).resolves.toBeUndefined();
    });

    it("uses durable completedRuns for ends_after_runs and never counts an unfinished active attempt", async () => {
      const authority = scheduleAuthority({
        stopRule: { mode: "ends_after_runs", maxRuns: 3 },
      });
      // Active 3rd run still executing (durable completedRuns = 2 < 3) -> refused
      // mid-run so a failing final attempt cannot delete its own schedule.
      await expect(
        requireScheduledRunMayEnd(
          authorityTx({
            authority,
            completedRuns: 2,
            runStatus: "CLAIMED",
          }),
          "turn-1",
          "delete_schedule",
          { scheduleId: OWN },
        ),
      ).rejects.toThrow(refused);
      await expect(
        requireScheduledRunMayEnd(
          authorityTx({
            authority,
            completedRuns: 2,
            runStatus: "RUNNING",
          }),
          "turn-1",
          "update_schedule",
          { scheduleId: OWN, enabled: false },
        ),
      ).rejects.toThrow(refused);
      // Once durable completedRuns reaches maxRuns (even after earlier run rows
      // are purged at 7 days), the stop rule evaluates allowed.
      await expect(
        requireScheduledRunMayEnd(
          authorityTx({
            authority,
            completedRuns: 3,
            runStatus: "CLAIMED",
          }),
          "turn-1",
          "delete_schedule",
          { scheduleId: OWN },
        ),
      ).resolves.toBeUndefined();
    });

    it("enforces when_target_settled for Tasks", async () => {
      const authority = scheduleAuthority({
        stopRule: {
          mode: "when_target_settled",
          targetKind: "task",
          targetId: "task-123",
        },
      });
      for (const active of ["READY", "IN_PROGRESS", "INPUT_REQUIRED", null]) {
        await expect(
          requireScheduledRunMayEnd(
            authorityTx({ authority, taskStatus: active }),
            "turn-1",
            "delete_schedule",
            { scheduleId: OWN },
          ),
        ).rejects.toThrow(refused);
      }
      for (const settled of ["COMPLETED", "FAILED", "CANCELED"]) {
        await expect(
          requireScheduledRunMayEnd(
            authorityTx({ authority, taskStatus: settled }),
            "turn-1",
            "delete_schedule",
            { scheduleId: OWN },
          ),
        ).resolves.toBeUndefined();
      }
    });

    it("enforces when_target_settled for Jobs using canonical SokosumiJobStatus", async () => {
      const authority = scheduleAuthority({
        stopRule: {
          mode: "when_target_settled",
          targetKind: "job",
          targetId: "job-456",
        },
      });
      for (const active of [
        SokosumiJobStatus.PAYMENT_PENDING,
        SokosumiJobStatus.STARTED,
        SokosumiJobStatus.PROCESSING,
        SokosumiJobStatus.INPUT_REQUIRED,
        SokosumiJobStatus.RESULT_PENDING,
        null,
      ]) {
        await expect(
          requireScheduledRunMayEnd(
            authorityTx({ authority }),
            "turn-1",
            "delete_schedule",
            { scheduleId: OWN },
            undefined,
            { readJobStatus: vi.fn().mockResolvedValue(active) },
          ),
        ).rejects.toThrow(refused);
      }
      for (const settled of [
        SokosumiJobStatus.COMPLETED,
        SokosumiJobStatus.FAILED,
        SokosumiJobStatus.PAYMENT_FAILED,
        SokosumiJobStatus.REFUND_RESOLVED,
        SokosumiJobStatus.DISPUTE_RESOLVED,
      ]) {
        await expect(
          requireScheduledRunMayEnd(
            authorityTx({ authority }),
            "turn-1",
            "delete_schedule",
            { scheduleId: OWN },
            undefined,
            { readJobStatus: vi.fn().mockResolvedValue(settled) },
          ),
        ).resolves.toBeUndefined();
      }
    });

    it("fails closed on owner_authorized_stop, malformed authority, inactive bot, expiry, project mismatch, actor mismatch, and other schedules", async () => {
      // Unverifiable owner_authorized_stop fails closed.
      await expect(
        requireScheduledRunMayEnd(
          authorityTx({
            authority: scheduleAuthority({
              stopRule: {
                mode: "owner_authorized_stop",
                condition: "Once the customer confirms receipt",
              },
            }),
          }),
          "turn-1",
          "delete_schedule",
          { scheduleId: OWN },
        ),
      ).rejects.toThrow(refused);

      // Corrupt non-null authority never falls back to prompt wording.
      await expect(
        requireScheduledRunMayEnd(
          authorityTx({
            prompt: "Delete this schedule once done.",
            authority: { broken: true },
          }),
          "turn-1",
          "delete_schedule",
          { scheduleId: OWN },
        ),
      ).rejects.toThrow(refused);

      const dueAuthority = scheduleAuthority({
        stopRule: { mode: "ends_on", endsOn: "2026-11-01T00:00:00.000Z" },
        projectId: PROJECT_ID,
        expiresAt: "2026-12-31T00:00:00.000Z",
      });
      const now = new Date("2026-11-26T00:00:00.000Z");

      // Matching project + live bot succeeds.
      await expect(
        requireScheduledRunMayEnd(
          authorityTx({
            authority: dueAuthority,
            bot: { projectId: PROJECT_ID },
          }),
          "turn-1",
          "delete_schedule",
          { scheduleId: OWN },
          authorizedTurn({ source: "SCHEDULE" }),
          { now },
        ),
      ).resolves.toBeUndefined();

      // Different schedule id refused.
      await expect(
        requireScheduledRunMayEnd(
          authorityTx({
            authority: dueAuthority,
            bot: { projectId: PROJECT_ID },
          }),
          "turn-1",
          "delete_schedule",
          { scheduleId: OTHER },
          authorizedTurn({ source: "SCHEDULE" }),
          { now },
        ),
      ).rejects.toThrow(refused);

      // Wrong live project refused.
      await expect(
        requireScheduledRunMayEnd(
          authorityTx({
            authority: dueAuthority,
            bot: { projectId: "other-proj" },
          }),
          "turn-1",
          "delete_schedule",
          { scheduleId: OWN },
          authorizedTurn({ source: "SCHEDULE" }),
          { now },
        ),
      ).rejects.toThrow(refused);

      // Paused bot refused.
      await expect(
        requireScheduledRunMayEnd(
          authorityTx({
            authority: dueAuthority,
            bot: { projectId: PROJECT_ID, status: "PAUSED" },
          }),
          "turn-1",
          "delete_schedule",
          { scheduleId: OWN },
          authorizedTurn({ source: "SCHEDULE" }),
          { now },
        ),
      ).rejects.toThrow(refused);

      // Expired authority refused.
      await expect(
        requireScheduledRunMayEnd(
          authorityTx({
            authority: dueAuthority,
            bot: { projectId: PROJECT_ID },
          }),
          "turn-1",
          "delete_schedule",
          { scheduleId: OWN },
          authorizedTurn({ source: "SCHEDULE" }),
          { now: new Date("2027-01-01T00:00:00.000Z") },
        ),
      ).rejects.toThrow(refused);

      // Different actor on personal bot refused.
      await expect(
        requireScheduledRunMayEnd(
          authorityTx({
            authority: dueAuthority,
            bot: { projectId: PROJECT_ID },
          }),
          "turn-1",
          "delete_schedule",
          { scheduleId: OWN },
          authorizedTurn({ source: "SCHEDULE", actingUserId: TEAMMATE_ID }),
          { now },
        ),
      ).rejects.toThrow(refused);

      // Shared CMO bot scheduled run (actingUserId: null) rechecks the grantor's
      // live workspace membership and assigned organization seat.
      const cmoAuthority = scheduleAuthority({
        versionId: "cmo-v23",
        sharedBot: true,
        projectId: PROJECT_ID,
        stopRule: { mode: "ends_on", endsOn: "2026-11-01T00:00:00.000Z" },
      });
      const cmoTurn = authorizedTurn({
        source: "SCHEDULE",
        actingUserId: null,
        askedByKind: "TEAMMATE",
        versionId: "cmo-v23",
      });
      await expect(
        requireScheduledRunMayEnd(
          authorityTx({
            authority: cmoAuthority,
            bot: { userId: null, projectId: PROJECT_ID, versionId: "cmo-v23" },
            grantorWorkspace: { id: WORKSPACE_ID, organizationId: "org-1" },
          }),
          "turn-1",
          "delete_schedule",
          { scheduleId: OWN },
          cmoTurn,
          { now, checkOrganizationSeat: vi.fn().mockResolvedValue(true) },
        ),
      ).resolves.toBeUndefined();

      // Grantor removed from workspace after creating the shared schedule -> refused.
      await expect(
        requireScheduledRunMayEnd(
          authorityTx({
            authority: cmoAuthority,
            bot: { userId: null, projectId: PROJECT_ID, versionId: "cmo-v23" },
            grantorWorkspace: null,
          }),
          "turn-1",
          "delete_schedule",
          { scheduleId: OWN },
          cmoTurn,
          { now, checkOrganizationSeat: vi.fn().mockResolvedValue(true) },
        ),
      ).rejects.toThrow(refused);

      // Grantor kept workspace membership but lost assigned organization seat -> refused.
      await expect(
        requireScheduledRunMayEnd(
          authorityTx({
            authority: cmoAuthority,
            bot: { userId: null, projectId: PROJECT_ID, versionId: "cmo-v23" },
            grantorWorkspace: { id: WORKSPACE_ID, organizationId: "org-1" },
          }),
          "turn-1",
          "delete_schedule",
          { scheduleId: OWN },
          cmoTurn,
          { now, checkOrganizationSeat: vi.fn().mockResolvedValue(false) },
        ),
      ).rejects.toThrow(refused);

      // Eligible replacement member edits the shared CMO schedule's stop rule:
      // ownerUserId transfers to TEAMMATE_ID so live checks authorize against
      // the active replacement member rather than the departed grantor.
      const replaced = resolveUiScheduleAuthority(TEAMMATE_ID, {
        mode: "ends_on",
        endsOn: "2026-11-01T00:00:00+01:00",
      })({
        scheduleId: OWN,
        sokoBotId: BOT_ID,
        workspaceId: WORKSPACE_ID,
        existingAuthority: cmoAuthority,
        botProjectId: PROJECT_ID,
        botVersionId: "cmo-v23",
        sharedBot: true,
      });
      expect(replaced?.ownerUserId).toBe(TEAMMATE_ID);
      expect(replaced?.grantId).toBe(cmoAuthority.grantId);
      const replacementTx = authorityTx({
        authority: replaced,
        bot: { userId: null, projectId: PROJECT_ID, versionId: "cmo-v23" },
        grantorWorkspace: { id: WORKSPACE_ID, organizationId: "org-1" },
      });
      const checkReplacementSeat = vi.fn().mockResolvedValue(true);
      await expect(
        requireScheduledRunMayEnd(
          replacementTx,
          "turn-1",
          "delete_schedule",
          { scheduleId: OWN },
          cmoTurn,
          { now, checkOrganizationSeat: checkReplacementSeat },
        ),
      ).resolves.toBeUndefined();
      expect(checkReplacementSeat).toHaveBeenCalledWith(
        TEAMMATE_ID,
        "org-1",
        replacementTx,
      );
    });

    it("enforces live grantor access and seat before recordCompletedScheduleRun disables a shared ends_after_runs schedule", async () => {
      const now = new Date("2026-11-26T08:00:00.000Z");
      const cmoRunsAuthority = scheduleAuthority({
        versionId: "cmo-v23",
        sharedBot: true,
        projectId: PROJECT_ID,
        stopRule: { mode: "ends_after_runs", maxRuns: 2 },
      });

      const makeSettlementTx = (opts: {
        authority: OwnerAuthority;
        completedRuns: number;
        grantorWorkspace: { id: string; organizationId: string | null } | null;
      }) => {
        const state = {
          enabled: true,
          completedRuns: opts.completedRuns,
          fenced: 0,
        };
        const settlementTx = {
          sokoBotSchedule: {
            update: vi.fn(
              async ({
                data,
              }: {
                data: {
                  enabled?: boolean;
                  completedRuns?: { increment: number };
                };
              }) => {
                if (data.completedRuns?.increment) {
                  state.completedRuns += data.completedRuns.increment;
                }
                if (data.enabled !== undefined) state.enabled = data.enabled;
                return {
                  id: OWN,
                  sokoBotId: BOT_ID,
                  workspaceId: WORKSPACE_ID,
                  enabled: state.enabled,
                  completedRuns: state.completedRuns,
                  authority: opts.authority,
                  sokoBot: {
                    userId: null,
                    archivedAt: null,
                    status: "RUNNING",
                    adminPausedAt: null,
                    projectId: PROJECT_ID,
                    versionId: "cmo-v23",
                  },
                };
              },
            ),
          },
          sokoBotScheduleRun: {
            updateMany: vi.fn(async () => {
              state.fenced += 1;
              return { count: 1 };
            }),
          },
          workspace: {
            findFirst: vi.fn().mockResolvedValue(opts.grantorWorkspace),
          },
        } as unknown as Prisma.TransactionClient;
        return { settlementTx, state };
      };

      // Departed grantor (no workspace access): completion is recorded, schedule stays enabled.
      const departed = makeSettlementTx({
        authority: cmoRunsAuthority,
        completedRuns: 1,
        grantorWorkspace: null,
      });
      expect(
        await recordCompletedScheduleRun(departed.settlementTx, OWN, now, {
          checkOrganizationSeat: vi.fn().mockResolvedValue(true),
        }),
      ).toEqual({ stopped: false });
      expect(departed.state).toEqual({
        enabled: true,
        completedRuns: 2,
        fenced: 0,
      });

      // Grantor without assigned org seat: completion is recorded, schedule stays enabled.
      const unseated = makeSettlementTx({
        authority: cmoRunsAuthority,
        completedRuns: 1,
        grantorWorkspace: { id: WORKSPACE_ID, organizationId: "org-1" },
      });
      expect(
        await recordCompletedScheduleRun(unseated.settlementTx, OWN, now, {
          checkOrganizationSeat: vi.fn().mockResolvedValue(false),
        }),
      ).toEqual({ stopped: false });
      expect(unseated.state).toEqual({
        enabled: true,
        completedRuns: 2,
        fenced: 0,
      });

      // Eligible replacement member edits the rule on the SAME schedule already
      // at completedRuns = 2 (after departed grantor left it enabled): grantor
      // transfers AND the already-met limit disables & fences pending runs
      // immediately so a 3rd occurrence never starts.
      const sameSchedule = {
        id: OWN,
        sokoBotId: BOT_ID,
        requestedByUserId: OWNER_ID,
        workspaceId: WORKSPACE_ID,
        name: "CMO digest",
        timezone: "UTC",
        cronExpression: "0 9 1 * *",
        prompt: "Send CMO digest.",
        enabled: departed.state.enabled,
        completedRuns: departed.state.completedRuns,
        runOnce: false,
        nextRunAt: new Date("2099-01-01T09:00:00.000Z"),
        systemKey: null as string | null,
        authority: cmoRunsAuthority as unknown,
      };
      let handoffFenced = 0;
      const handoffTx = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: OWN }]),
        workspace: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: WORKSPACE_ID, organizationId: null }),
        },
        sokoBot: {
          findFirst: vi.fn().mockResolvedValue({
            id: BOT_ID,
            userId: null,
            workspaceId: WORKSPACE_ID,
            workspace: { organizationId: "org-1" },
          }),
          findUnique: vi.fn().mockResolvedValue({
            userId: null,
            archivedAt: null,
            status: "RUNNING",
            adminPausedAt: null,
            projectId: PROJECT_ID,
            versionId: "cmo-v23",
            workspace: { organizationId: null },
          }),
        },
        sokoBotSchedule: {
          findFirst: vi.fn(async () => ({ ...sameSchedule })),
          findUniqueOrThrow: vi.fn(async () => ({
            completedRuns: sameSchedule.completedRuns,
            enabled: sameSchedule.enabled,
            authority: sameSchedule.authority,
            sokoBot: {
              userId: null,
              archivedAt: null,
              status: "RUNNING",
              adminPausedAt: null,
              projectId: PROJECT_ID,
              versionId: "cmo-v23",
            },
          })),
          update: vi.fn(
            async ({
              data,
            }: {
              data: { enabled?: boolean; authority?: unknown };
            }) => {
              if (data.enabled !== undefined)
                sameSchedule.enabled = data.enabled;
              if (data.authority !== undefined)
                sameSchedule.authority = data.authority;
              return { ...sameSchedule };
            },
          ),
          count: vi.fn().mockResolvedValue(1),
        },
        sokoBotScheduleRun: {
          updateMany: vi.fn(async () => {
            handoffFenced += 1;
            return { count: 1 };
          }),
        },
        sokoBotScheduleRunChange: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      } as unknown as Prisma.TransactionClient;

      // Personal/shared seat check runs only when bot.userId === null with
      // organizationId; mock the seat check cleanly via workspace org null
      // on the bot lookup here and verify the live seat check below.
      (
        handoffTx.sokoBot.findFirst as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce({
        id: BOT_ID,
        userId: null,
        workspaceId: WORKSPACE_ID,
        workspace: { organizationId: null },
      });
      const updatedAfterHandoff = await updateSokoBotSchedule(
        {
          userId: TEAMMATE_ID,
          scheduleId: OWN,
          workspaceId: WORKSPACE_ID,
          sokoBotId: BOT_ID,
          resolveAuthority: resolveUiScheduleAuthority(TEAMMATE_ID, {
            mode: "ends_after_runs",
            maxRuns: 2,
          }),
        },
        handoffTx,
      );
      expect(updatedAfterHandoff.enabled).toBe(false);
      expect(
        (updatedAfterHandoff.authority as OwnerAuthority).ownerUserId,
      ).toBe(TEAMMATE_ID);
      expect(sameSchedule).toMatchObject({ enabled: false, completedRuns: 2 });
      expect(handoffFenced).toBe(1);

      // Re-enabling that exhausted schedule without raising maxRuns keeps it
      // disabled and fences unstarted runs again.
      (
        handoffTx.sokoBot.findFirst as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce({
        id: BOT_ID,
        userId: null,
        workspaceId: WORKSPACE_ID,
        workspace: { organizationId: null },
      });
      const reenabledExhausted = await updateSokoBotSchedule(
        {
          userId: TEAMMATE_ID,
          scheduleId: OWN,
          workspaceId: WORKSPACE_ID,
          sokoBotId: BOT_ID,
          enabled: true,
        },
        handoffTx,
      );
      expect(reenabledExhausted.enabled).toBe(false);
      expect(handoffFenced).toBe(2);

      // Separate control: when the replacement member transferred authority
      // before the final run settled, settlement verifies the replacement's
      // live org seat and disables & fences pending runs on completion.
      const replaced = resolveUiScheduleAuthority(TEAMMATE_ID, {
        mode: "ends_after_runs",
        maxRuns: 2,
      })({
        scheduleId: OWN,
        sokoBotId: BOT_ID,
        workspaceId: WORKSPACE_ID,
        existingAuthority: cmoRunsAuthority,
        botProjectId: PROJECT_ID,
        botVersionId: "cmo-v23",
        sharedBot: true,
      })!;
      expect(replaced.ownerUserId).toBe(TEAMMATE_ID);
      const activeReplacement = makeSettlementTx({
        authority: replaced,
        completedRuns: 1,
        grantorWorkspace: { id: WORKSPACE_ID, organizationId: "org-1" },
      });
      const checkSeat = vi.fn().mockResolvedValue(true);
      expect(
        await recordCompletedScheduleRun(
          activeReplacement.settlementTx,
          OWN,
          now,
          { checkOrganizationSeat: checkSeat },
        ),
      ).toEqual({ stopped: true });
      expect(checkSeat).toHaveBeenCalledWith(
        TEAMMATE_ID,
        "org-1",
        activeReplacement.settlementTx,
      );
      expect(activeReplacement.state).toEqual({
        enabled: false,
        completedRuns: 2,
        fenced: 1,
      });
      expect(disableScheduleIfCountLimitMet).toBeTypeOf("function");
    });
  });
});

describe("resolveBotScheduleAuthority", () => {
  const baseContext = {
    scheduleId: OWN,
    sokoBotId: BOT_ID,
    workspaceId: WORKSPACE_ID,
    existingAuthority: null as OwnerAuthority | null,
    botProjectId: PROJECT_ID as string | null,
    botVersionId: "v36" as string | null,
    sharedBot: false,
  };

  it("mints project-scoped schedule authority with stopRule and allowScheduledPosts from direct owner chat", () => {
    const resolve = resolveBotScheduleAuthority(
      authorizedTurn(),
      {
        stopRule: { mode: "ends_after_runs", maxRuns: 4 },
        allowScheduledPosts: true,
      },
      { isUpdate: false },
    );
    const created = resolve(baseContext);
    expect(created).toMatchObject({
      origin: "owner_chat",
      ownerUserId: OWNER_ID,
      rootTurnId: ROOT_TURN_ID,
      scheduleId: OWN,
      targetScope: { kind: "project", projectId: PROJECT_ID },
      socialMode: "schedule_posts",
      stopRule: { mode: "ends_after_runs", scheduleId: OWN, maxRuns: 4 },
    });
  });

  it("lets a later direct owner chat update stopRule and posting permission while preserving grant metadata", () => {
    const existing = scheduleAuthority({
      projectId: PROJECT_ID,
      expiresAt: "2026-12-31T00:00:00.000Z",
      limits: { images: 2, maxMediaCredits: 10 },
      stopRule: { mode: "ends_after_runs", maxRuns: 5 },
    });
    const resolve = resolveBotScheduleAuthority(
      authorizedTurn({ id: LATER_TURN_ID }),
      {
        stopRule: { mode: "never" },
        allowScheduledPosts: true,
      },
      { isUpdate: true },
    );
    const updated = resolve({ ...baseContext, existingAuthority: existing });
    expect(updated).toEqual({
      ...existing,
      socialMode: "schedule_posts",
      stopRule: { mode: "never" },
    });
  });

  it("preserves existing authority untouched on unrelated schedule edits or name upserts", () => {
    const existing = scheduleAuthority({
      stopRule: { mode: "ends_after_runs", maxRuns: 2 },
    });
    const fromScheduleRun = resolveBotScheduleAuthority(
      authorizedTurn({ source: "SCHEDULE" }),
      {},
      { isUpdate: true },
    );
    expect(
      fromScheduleRun({ ...baseContext, existingAuthority: existing }),
    ).toBeUndefined();

    const fromUpsert = resolveBotScheduleAuthority(
      authorizedTurn({ source: "SCHEDULE" }),
      {},
      { isUpdate: false },
    );
    expect(
      fromUpsert({ ...baseContext, existingAuthority: existing }),
    ).toBeUndefined();
  });

  it.each([
    ["SCHEDULE turn", { source: "SCHEDULE" }],
    ["EVENT turn", { source: "EVENT" }],
    ["background CHAT turn", { source: "CHAT", parentTurnId: ROOT_TURN_ID }],
    [
      "assistant turn",
      { source: "CHAT", chainDepth: 1, askedByKind: "ASSISTANT" as const },
    ],
    [
      "non-CMO teammate turn",
      {
        source: "CHAT",
        askedByUserId: TEAMMATE_ID,
        askedByKind: "TEAMMATE" as const,
      },
    ],
  ])(
    "refuses stopRule or allowScheduledPosts mutations from a %s",
    (_label, turnOverrides) => {
      const existing = scheduleAuthority({
        stopRule: { mode: "ends_after_runs", maxRuns: 3 },
      });
      const turn = authorizedTurn(turnOverrides);

      expect(() =>
        resolveBotScheduleAuthority(
          turn,
          { stopRule: { mode: "ends_after_runs", maxRuns: 1 } },
          { isUpdate: false },
        )(baseContext),
      ).toThrow(OwnerAuthorityError);

      expect(() =>
        resolveBotScheduleAuthority(
          turn,
          { stopRule: { mode: "never" } },
          { isUpdate: true },
        )({ ...baseContext, existingAuthority: existing }),
      ).toThrow(OwnerAuthorityError);

      expect(() =>
        resolveBotScheduleAuthority(
          turn,
          { allowScheduledPosts: true },
          { isUpdate: false },
        )(baseContext),
      ).toThrow(OwnerAuthorityError);

      // Without stopRule or allowScheduledPosts, creating a brand-new schedule
      // persists system authority with stopRule: never (cannot self-delete).
      const created = resolveBotScheduleAuthority(
        turn,
        {},
        { isUpdate: false },
      )(baseContext);
      expect(created).toMatchObject({
        origin: "system",
        ownerUserId: null,
        scheduleId: OWN,
        scope: "read_only",
        socialMode: "none",
        stopRule: { mode: "never" },
      });
    },
  );

  it("lets direct owner chat add a stopRule to a legacy or system schedule, and lets a CMO teammate set one", () => {
    const legacyUpgraded = resolveBotScheduleAuthority(
      authorizedTurn(),
      { stopRule: { mode: "ends_on", endsOn: "2026-12-01T00:00:00.000Z" } },
      { isUpdate: true },
    )({ ...baseContext, existingAuthority: null });
    expect(legacyUpgraded).toMatchObject({
      origin: "owner_chat",
      scheduleId: OWN,
      stopRule: {
        mode: "ends_on",
        scheduleId: OWN,
        endsOn: "2026-12-01T00:00:00.000Z",
      },
    });

    const cmoExisting = bindScheduleStopRule(
      scheduleAuthority({
        versionId: "cmo-v23",
        sharedBot: true,
        projectId: PROJECT_ID,
      }),
      {
        scheduleId: OWN,
        stopRule: { mode: "ends_after_runs", maxRuns: 2 },
        edit: {
          kind: "owner_chat",
          actorUserId: OWNER_ID,
          sokoBotId: BOT_ID,
          workspaceId: WORKSPACE_ID,
          turnId: ROOT_TURN_ID,
          source: "CHAT",
          parentTurnId: null,
          chainDepth: 0,
          askedByKind: "TEAMMATE",
          allowWorkspaceMember: true,
        },
      },
    );
    const cmoUpdated = resolveBotScheduleAuthority(
      authorizedTurn({
        id: LATER_TURN_ID,
        actingUserId: TEAMMATE_ID,
        requestedByUserId: TEAMMATE_ID,
        askedByUserId: TEAMMATE_ID,
        askedByKind: "TEAMMATE",
        versionId: "cmo-v23",
      }),
      { stopRule: { mode: "ends_after_runs", maxRuns: 5 } },
      { isUpdate: true },
    )({
      ...baseContext,
      sharedBot: true,
      botVersionId: "cmo-v23",
      existingAuthority: cmoExisting,
    });
    expect(cmoUpdated?.stopRule).toEqual({
      mode: "ends_after_runs",
      scheduleId: OWN,
      maxRuns: 5,
    });
  });
});

describe("resolveUiScheduleAuthority", () => {
  const baseContext = {
    scheduleId: OWN,
    sokoBotId: BOT_ID,
    workspaceId: WORKSPACE_ID,
    existingAuthority: null as OwnerAuthority | null,
    botProjectId: PROJECT_ID as string | null,
    botVersionId: "v36" as string | null,
    sharedBot: false,
  };

  it("mints owner_ui authority on create and preserves chat grant metadata on UI stopRule update", () => {
    const created = resolveUiScheduleAuthority(OWNER_ID, {
      mode: "ends_on",
      endsOn: "2026-12-15T00:00:00.000Z",
    })(baseContext);
    expect(created).toMatchObject({
      origin: "owner_ui",
      ownerUserId: OWNER_ID,
      rootTurnId: null,
      scheduleId: OWN,
      targetScope: { kind: "project", projectId: PROJECT_ID },
      stopRule: {
        mode: "ends_on",
        scheduleId: OWN,
        endsOn: "2026-12-15T00:00:00.000Z",
      },
    });

    const chatSchedule = scheduleAuthority({
      projectId: PROJECT_ID,
      expiresAt: "2026-12-31T00:00:00.000Z",
      limits: { images: 3, maxMediaCredits: 15 },
      stopRule: { mode: "ends_after_runs", maxRuns: 2 },
    });

    // Upsert without stopRule preserves existing chat authority verbatim.
    expect(
      resolveUiScheduleAuthority(OWNER_ID)({
        ...baseContext,
        existingAuthority: chatSchedule,
      }),
    ).toBeUndefined();

    // UI stopRule edit on chat-created schedule preserves grantId, origin,
    // rootTurnId, targetScope, limits, and expiresAt.
    const updated = resolveUiScheduleAuthority(OWNER_ID, {
      mode: "never",
    })({ ...baseContext, existingAuthority: chatSchedule });
    expect(updated).toEqual({
      ...chatSchedule,
      stopRule: { mode: "never" },
    });

    // Another user cannot edit a personal bot schedule's stop rule via UI.
    expect(() =>
      resolveUiScheduleAuthority(TEAMMATE_ID, { mode: "never" })({
        ...baseContext,
        existingAuthority: chatSchedule,
      }),
    ).toThrow(OwnerAuthorityError);
  });
});

describe("resolveRequestedScheduleCapabilities and capability-aware authority edits", () => {
  const baseContext = {
    scheduleId: OWN,
    sokoBotId: BOT_ID,
    workspaceId: WORKSPACE_ID,
    existingAuthority: null as OwnerAuthority | null,
    botProjectId: null as string | null,
    botVersionId: "v36" as string | null,
    sharedBot: false,
  };

  it("bounds explicit schedule capabilities by the authoring turn's grant and deduplicates", () => {
    expect(
      resolveRequestedScheduleCapabilities(undefined, [
        "read_table",
        "write_table_rows",
        "create_schedule",
      ]),
    ).toEqual(["read_table", "write_table_rows", "create_schedule"]);

    expect(
      resolveRequestedScheduleCapabilities(
        ["read_table", "read_table"],
        ["read_table", "write_table_rows", "create_schedule"],
      ),
    ).toEqual(["read_table"]);

    expect(() =>
      resolveRequestedScheduleCapabilities(
        ["read_table", "write_table_rows"],
        ["read_table", "create_schedule"],
      ),
    ).toThrow(/write_table_rows/);

    // Unknown tool names are also refused by the grant bound (schema stays compact without a 186-tool enum).
    expect(() =>
      resolveRequestedScheduleCapabilities(
        ["nonexistent_tool"],
        ["read_table", "create_schedule"],
      ),
    ).toThrow(/nonexistent_tool/);
  });

  it("keeps create_schedule and update_schedule JSON schemas compact without listing all 186 tool names", async () => {
    const { z } = await import("zod");
    const {
      sokoBotCreateScheduleInputSchema,
      sokoBotUpdateScheduleInputSchema,
    } = await import("@sokosumi/soko-bot");
    const createJson = z.toJSONSchema(sokoBotCreateScheduleInputSchema) as {
      properties?: { capabilities?: { items?: { enum?: unknown } } };
    };
    const updateJson = z.toJSONSchema(sokoBotUpdateScheduleInputSchema) as {
      properties?: { capabilities?: { items?: { enum?: unknown } } };
    };
    expect(createJson.properties?.capabilities?.items?.enum).toBeUndefined();
    expect(updateJson.properties?.capabilities?.items?.enum).toBeUndefined();
    expect(
      Buffer.byteLength(
        JSON.stringify(createJson.properties?.capabilities),
        "utf8",
      ),
    ).toBeLessThan(250);
    expect(
      Buffer.byteLength(
        JSON.stringify(updateJson.properties?.capabilities),
        "utf8",
      ),
    ).toBeLessThan(250);
    expect(
      sokoBotUpdateScheduleInputSchema.safeParse({
        scheduleId: OWN,
        prompt: "New prompt",
        capabilities: ["read_table"],
        keepCapabilities: true,
      }).success,
    ).toBe(false);
  });

  it("upgrades system/legacy authority on capability edits only from direct top-level owner chat", () => {
    const systemAuthority = attenuateForChildWork(
      mintTurnOwnerAuthority({
        turn: {
          id: LATER_TURN_ID,
          sokoBotId: BOT_ID,
          workspaceId: WORKSPACE_ID,
          versionId: "v36",
          source: "CHAT",
          parentTurnId: ROOT_TURN_ID,
          chainDepth: 0,
          askedByUserId: null,
          requestedByUserId: OWNER_ID,
        },
        actingUserId: OWNER_ID,
        askedByKind: "OWNER",
      }),
      "schedule",
      { versionId: "v36", scheduleId: OWN },
    );
    const bgTurn = authorizedTurn({
      id: LATER_TURN_ID,
      parentTurnId: ROOT_TURN_ID,
      botProjectId: null,
    });
    const directOwnerTurn = authorizedTurn({
      id: ROOT_TURN_ID,
      parentTurnId: null,
      botProjectId: null,
    });

    // Background run editing capabilities on a system schedule cannot upgrade authority.
    expect(
      resolveBotScheduleAuthority(
        bgTurn,
        { capabilities: ["read_table", "write_table_rows"] },
        { isUpdate: true },
      )({ ...baseContext, existingAuthority: systemAuthority }),
    ).toBeUndefined();

    // Background run editing capabilities on a legacy null schedule initializes read_only system authority.
    expect(
      resolveBotScheduleAuthority(
        bgTurn,
        { capabilities: ["read_table", "write_table_rows"] },
        { isUpdate: true },
      )({ ...baseContext, existingAuthority: null }),
    ).toMatchObject({
      origin: "system",
      scope: "read_only",
      socialMode: "none",
    });

    // Direct top-level owner chat editing capabilities on a system schedule upgrades to owner_writes.
    expect(
      resolveBotScheduleAuthority(
        directOwnerTurn,
        { capabilities: ["read_table", "write_table_rows"] },
        { isUpdate: true },
      )({ ...baseContext, existingAuthority: systemAuthority }),
    ).toMatchObject({
      origin: "owner_chat",
      ownerUserId: OWNER_ID,
      scope: "owner_writes",
      socialMode: "draft_only",
    });
  });
});

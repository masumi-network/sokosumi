import { A2A_SCENARIOS } from "@sokosumi/soko-bot";
import { afterAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db/prisma";
import { globalCoworkersFor } from "@/lib/evals/eval-guard";
import { takeEvalCoworkerReply } from "@/lib/evals/fake-coworker";
import { closeA2aWorld, prepareA2aCase } from "./eval-a2a";
import { ensureEvalLanes } from "./eval-lanes.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

describe.skipIf(!enabled)("agent-to-agent eval world", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("gives a case Mira, Juno and Hannah's Task, and takes them away after", async () => {
    const [lane] = await ensureEvalLanes(1);
    if (!lane) throw new Error("no lane");
    const scenario = A2A_SCENARIOS.find(
      (candidate) => candidate.id === "a2a-ask-and-relay",
    );
    if (!scenario) throw new Error("no scenario");

    const state = await prepareA2aCase(lane, scenario);
    const { coworkerId, junoId } = state.a2a as {
      coworkerId: string;
      junoId: string;
    };
    const access = () =>
      prisma.coworkerWorkspaceAccess.findFirstOrThrow({
        where: { coworkerId, workspaceId: lane.workspaceId },
        select: { status: true },
      });
    const juno = () =>
      prisma.sokoBot.findUniqueOrThrow({
        where: { id: junoId },
        select: {
          proactivePaused: true,
          chatRoomMemberships: { select: { roomId: true } },
        },
      });
    expect((await access()).status).toBe("GRANTED");
    expect(await juno()).toMatchObject({
      proactivePaused: false,
      chatRoomMemberships: [{ roomId: lane.world.roomId }],
    });
    expect(
      await prisma.task.count({
        where: {
          workspaceId: lane.workspaceId,
          assigneeUserId: lane.world.hannahUserId,
          archivedAt: null,
        },
      }),
    ).toBe(1);
    // Her own workspace's Coworker, never a global one.
    expect(await globalCoworkersFor(lane.workspaceId)).toEqual([]);
    expect(await takeEvalCoworkerReply(coworkerId)).toContain("€25 per seat");

    await closeA2aWorld(lane);
    expect((await access()).status).toBe("REVOKED");
    expect(await juno()).toMatchObject({
      proactivePaused: true,
      chatRoomMemberships: [],
    });
    expect(
      await prisma.task.count({
        where: {
          workspaceId: lane.workspaceId,
          assigneeUserId: lane.world.hannahUserId,
          archivedAt: null,
        },
      }),
    ).toBe(0);
  });
});

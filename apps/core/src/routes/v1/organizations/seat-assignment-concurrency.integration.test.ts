import { randomUUID } from "node:crypto";
import { memberRepository } from "@sokosumi/database/repositories";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";

/**
 * Proves SOK-1007 against a real Postgres: `assignSeat` counts the assigned
 * members, checks the count against the purchased seats and then writes, so
 * without serialization two concurrent assignments for different members both
 * pass the check and the organization ends up over capacity.
 *
 * Opt in with a disposable migrated Postgres, like the chat integration tests:
 *
 *   createdb sokosumi_seat_scratch
 *   DATABASE_URL=postgres://localhost/sokosumi_seat_scratch \
 *     pnpm --filter @sokosumi/database exec prisma migrate deploy
 *   SEAT_CONCURRENCY_INTEGRATION_DATABASE_URL=postgres://localhost/sokosumi_seat_scratch \
 *     pnpm --filter @sokosumi/core exec vitest run seat-assignment-concurrency
 *
 * CI never runs it: without the variable every case is skipped.
 */
const databaseUrl = process.env.SEAT_CONCURRENCY_INTEGRATION_DATABASE_URL;
const describeWithDb = databaseUrl ? describe : describe.skip;

vi.mock("@/lib/db/prisma", async () => {
  const { createPrismaClient } = await import("@sokosumi/database/client");
  const url = process.env.SEAT_CONCURRENCY_INTEGRATION_DATABASE_URL;
  return { default: url ? createPrismaClient(url) : {} };
});

const MEMBER_COUNT = 4;
const PURCHASED_SEATS = MEMBER_COUNT - 1;

const organizationId = randomUUID();
const workspaceId = randomUUID();
const userIds = Array.from({ length: MEMBER_COUNT }, () => randomUUID());

async function resetSeats(): Promise<string[]> {
  await prisma.member.updateMany({
    where: { organizationId },
    data: { seatAssignedAt: null },
  });

  const members = await prisma.member.findMany({
    where: { organizationId },
    orderBy: { userId: "asc" },
    select: { id: true },
  });
  return members.map((member) => member.id);
}

async function countAssigned(): Promise<number> {
  return await prisma.member.count({
    where: { organizationId, seatAssignedAt: { not: null } },
  });
}

describeWithDb("assignSeat under concurrency with Postgres", () => {
  beforeAll(async () => {
    for (const id of userIds) {
      await prisma.user.create({
        data: {
          id,
          name: `Seat race ${id}`,
          email: `${id}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }

    await prisma.organization.create({
      data: {
        id: organizationId,
        slug: `seat-race-${organizationId}`,
        name: "Seat race test",
        workspace: { create: { id: workspaceId } },
        members: {
          create: userIds.map((userId) => ({
            userId,
            role: "member",
            seatAssignedAt: null,
          })),
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.member.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("keeps assignments within the purchased seats when every request races", async () => {
    const memberIds = await resetSeats();

    const outcomes = await Promise.allSettled(
      memberIds.map((memberId) =>
        serializableTransaction(
          async (tx) =>
            await memberRepository.assignSeat(
              memberId,
              organizationId,
              PURCHASED_SEATS,
              tx,
            ),
          "Seat assignment lost a concurrent update. Try again.",
        ),
      ),
    );

    const fulfilled = outcomes.filter(
      (outcome) => outcome.status === "fulfilled",
    );
    const rejected = outcomes.filter(
      (outcome) => outcome.status === "rejected",
    );

    expect(await countAssigned()).toBe(PURCHASED_SEATS);
    expect(fulfilled).toHaveLength(PURCHASED_SEATS);
    expect(rejected).toHaveLength(MEMBER_COUNT - PURCHASED_SEATS);
  });

  it("over-assigns without serialization, which is the defect this guards", async () => {
    const memberIds = await resetSeats();

    await Promise.allSettled(
      memberIds.map((memberId) =>
        prisma.$transaction(async (tx) =>
          memberRepository.assignSeat(
            memberId,
            organizationId,
            PURCHASED_SEATS,
            tx,
          ),
        ),
      ),
    );

    // Read Committed lets every reader see the same pre-write count, so the
    // capacity check passes for more members than the organization bought.
    // The race is timing-dependent, so this asserts the bound it fails to
    // hold rather than an exact number.
    expect(await countAssigned()).toBeGreaterThan(PURCHASED_SEATS);
  });
});

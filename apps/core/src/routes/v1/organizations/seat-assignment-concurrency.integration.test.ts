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

// More members than seats by a wide margin: the unserialized case needs only
// two requests to read the same count, and the slack keeps it off a knife edge
// if the connection pool happens to serialize some of them.
const MEMBER_COUNT = 8;
const PURCHASED_SEATS = 3;

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

    // Safety is exact: the count must never pass the purchased seats. That is
    // the invariant the ticket is about.
    const assigned = await countAssigned();
    expect(assigned).toBeLessThanOrEqual(PURCHASED_SEATS);
    expect(fulfilled).toHaveLength(assigned);
    expect(rejected).toHaveLength(MEMBER_COUNT - assigned);

    // Liveness is not exact: a would-be winner can burn all 8 attempts and
    // give up, which leaves a seat unsold. That is an unhappy outcome, not a
    // broken one, so it only has to explain itself with a conflict rejection.
    const rejectionMessages = rejected.map((outcome) => {
      const { reason } = outcome as PromiseRejectedResult;
      return reason instanceof Error ? reason.message : String(reason);
    });
    if (assigned < PURCHASED_SEATS) {
      expect(
        rejectionMessages.some((message) =>
          message.includes("lost a concurrent update"),
        ),
      ).toBe(true);
    }

    // Counting rejections alone would pass just as well on "Member not found",
    // which is a different defect wearing the same shape. Losing the capacity
    // check is the expected outcome; exhausting the retry budget is a legal if
    // unhappy one under real contention, so both are allowed and nothing else
    // is.
    for (const message of rejectionMessages) {
      expect(
        message.includes("exceeds purchased seats") ||
          message.includes("lost a concurrent update"),
      ).toBe(true);
    }
  });

  it("over-assigns without serialization, which is the defect this guards", async () => {
    // This case needs the server's default isolation level to actually be Read
    // Committed. A database or role carrying
    // `default_transaction_isolation = 'serializable'` makes the bare
    // transaction below serializable too, and the case would report the fix as
    // broken when nothing is wrong with it.
    const [{ level }] = await prisma.$queryRaw<{ level: string }[]>`
      SELECT current_setting('default_transaction_isolation') AS level
    `;
    if (level !== "read committed") {
      console.warn(
        `Skipping the unserialized case: default_transaction_isolation is "${level}", not "read committed".`,
      );
      return;
    }

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

    // Read Committed lets concurrent readers see the same pre-write count, so
    // the capacity check passes for more members than the organization bought.
    //
    // This case deliberately calls prisma.$transaction rather than a shipped
    // route: it demonstrates the defect the fix removes, so it pins the shape
    // of assignSeat, not the behaviour of a caller. If assignSeat ever becomes
    // a single atomic conditional write, this is the case that must be
    // deleted, and its failure says exactly that.
    expect(await countAssigned()).toBeGreaterThan(PURCHASED_SEATS);
  });
});

/**
 * REPRODUCTION ARTIFACT — `file_result_window` has an `expiresAt`, an index on
 * it, and nothing that ever deletes a row.
 *
 * Written by the reviewer, not the implementer. Red at `bbd037236`.
 *
 * **To run:** drop this file into `apps/core/src/routes/sync/drive-index/`,
 * then
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgres://... \
 *     pnpm --filter core test .postgres.test.ts --no-file-parallelism
 *
 * `optInDbExclude` matches `src/**\/*.postgres.test.ts`, so it is out of the
 * unit run and in the Postgres run with no config change. The imports are
 * alias-based, so it also runs from anywhere else under `src/`.
 *
 * **The defect.** `search-session.ts` uses the model exactly twice —
 * `fileResultWindow.create` when a search starts, and `findUnique` when a
 * cursor is followed. There is no `delete`, `deleteMany` or raw delete against
 * the table anywhere in the repository. Every search by every actor writes a
 * row carrying its whole result ordering in `entries`, and the row stays
 * forever. `expiresAt` is written, is checked on read, and is the sole reason
 * `@@index([expiresAt])` exists — an index whose only purpose is a sweep that
 * was never written.
 *
 * `/sync/drive-index` is where that sweep belongs: it already ends with
 * `pruneExpiredAdmissions()`, for the same reason, over the other table this
 * feature grows without bound.
 *
 * **What this costs.** Nothing visible, which is why it needs a test rather
 * than a report. The rows are never read again — a cursor older than
 * `expiresAt` is refused — so search keeps working while the table grows one
 * row per search per actor, each holding a JSON array of up to the window cap
 * of result positions.
 *
 * **Deliberately asserted against the sync cycle, not against a function.**
 * The test drives the real `/sync/drive-index` route with the real cron
 * authentication and awaits the background work the handler hands to
 * `waitUntil`. It never names a pruner. A pruner that is written and not wired
 * into the cycle leaves this red, which is the property that matters: an
 * unreferenced cleanup function is the same as no cleanup function. Only the
 * lock service and `waitUntil` are stubbed, because the first needs a
 * single-process lock and the second is Vercel's runtime.
 *
 * **Measured on PostgreSQL 18.6 against the branch at bbd037236**, after one
 * full `/sync/drive-index` cycle:
 *
 *   expired windows before the cycle : 2
 *   expired windows after the cycle  : 2
 *   live window after the cycle      : present   (correct)
 *   expired admissions before        : 1
 *   expired admissions after         : 0         (the existing pruner ran)
 */
import { randomUUID } from "node:crypto";
import { FileResultWindowKind } from "@sokosumi/database";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { acquire, release, pending, env } = vi.hoisted(() => ({
  acquire: vi.fn(),
  release: vi.fn(),
  pending: [] as Promise<unknown>[],
  env: {
    VERCEL_ENV: "test",
    CRON_SECRET: "repro-secret",
    // The documented production values from `apps/core/.env.example`, so the
    // cycle under test is the production cycle. They matter: the extraction
    // stage refuses to lease a job unless
    // `EXTRACTION_JOB_WORST_CASE_MS + SYNC_TAIL_RESERVE_MS` (80s) fits in the
    // window, and 120,000 - 25,000 = 95,000 is what makes it fit. A smaller
    // window here would silently skip extraction and weaken case 1.
    LOCK_TIMEOUT: 120_000,
    LOCK_TIMEOUT_BUFFER: 25_000,
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
    // The model stays off. This is about a table, not about Jev.
    AI_GATEWAY_API_KEY: undefined as string | undefined,
    FILES_JEV_ENABLED: false,
    INSTANCE_ID: "instance-under-test",
  },
}));

vi.mock("@/config/env", () => ({ getEnv: () => env }));
vi.mock("@/services/sync-lock.service", () => ({
  syncLockService: { acquireLock: acquire, releaseLock: release },
}));
// Partial: `prisma.ts` also imports `attachDatabasePool` from here.
vi.mock("@vercel/functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/functions")>()),
  waitUntil: (work: Promise<unknown>) => {
    pending.push(work);
  },
}));

import prisma from "@/lib/db/prisma";
import mount from "@/routes/sync/drive-index/get";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const suffix = randomUUID().slice(0, 8);
const DAY = 86_400_000;

let ownerId = "";
let workspaceId = "";
let liveWindowId = "";
const expiredWindowIds: string[] = [];

let expiredWindowsBefore = 0;
let expiredWindowsAfter = 0;
let liveWindowSurvived = false;
let expiredAdmissionsBefore = 0;
let expiredAdmissionsAfter = 0;
/**
 * Captured in `beforeAll`, not asserted from `release.mock` in the case
 * itself: `src/test/setup.ts` resets mocks between tests, so the call history
 * is gone by then.
 */
let lockReleased = false;

async function seedWindow(expiresAt: Date): Promise<string> {
  const row = await prisma.fileResultWindow.create({
    data: {
      workspaceId,
      kind: FileResultWindowKind.SEARCH,
      actorFingerprint: `fp-${randomUUID()}`,
      bindingDigest: `bd-${randomUUID()}`,
      epochVector: "1",
      entries: [{ r: randomUUID(), c: 1, m: 1 }],
      truncated: false,
      expiresAt,
    },
    select: { id: true },
  });
  return row.id;
}

describe.skipIf(!enabled)(
  "the drive-index sync cycle must retire expired result windows",
  () => {
    beforeAll(async () => {
      const owner = await prisma.user.create({
        data: {
          name: "Window retention owner",
          email: `window-${suffix}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      ownerId = owner.id;
      workspaceId = (
        await prisma.workspace.create({
          data: { userId: ownerId },
          select: { id: true },
        })
      ).id;

      const now = Date.now();
      // Two windows nothing can ever read again: a cursor is refused once
      // `expiresAt` has passed.
      expiredWindowIds.push(await seedWindow(new Date(now - 30 * DAY)));
      expiredWindowIds.push(await seedWindow(new Date(now - 2 * 3_600_000)));
      // One that is still inside its life and must be left alone.
      liveWindowId = await seedWindow(new Date(now + 3_600_000));

      // The control: an admission far past any retention setting, which the
      // pruner the cycle already calls must remove. If this one survives, the
      // cycle did not run and the window assertion below would mean nothing.
      await prisma.fileAuthorizationAdmission.create({
        data: {
          workspaceId,
          actorFingerprint: `fp-${suffix}`,
          epochVector: "1",
          purpose: "repro-control",
          payloadDigest: `pd-${suffix}`,
          provider: "gateway",
          model: "typesafe-ai/jev",
          inputTokens: 1,
          admittedAt: new Date(now - 400 * DAY),
          expiresAt: new Date(now - 400 * DAY),
        },
      });

      expiredWindowsBefore = await prisma.fileResultWindow.count({
        where: { workspaceId, id: { in: expiredWindowIds } },
      });
      expiredAdmissionsBefore = await prisma.fileAuthorizationAdmission.count({
        where: { workspaceId },
      });

      acquire.mockResolvedValue({
        key: "drive-index-sync",
        ownerToken: "owner",
      });
      release.mockResolvedValue(true);

      const app = new Hono();
      mount(app);
      const response = await app.request("/drive-index", {
        headers: { authorization: `Bearer ${env.CRON_SECRET}` },
      });
      if (response.status !== 200) {
        throw new Error(
          `the sync route did not start: ${response.status} ` +
            `${await response.text()}`,
        );
      }
      // The handler hands the real work to `waitUntil`; this is that work.
      await Promise.all(pending);

      expiredWindowsAfter = await prisma.fileResultWindow.count({
        where: { workspaceId, id: { in: expiredWindowIds } },
      });
      liveWindowSurvived =
        (await prisma.fileResultWindow.count({
          where: { id: liveWindowId },
        })) === 1;
      expiredAdmissionsAfter = await prisma.fileAuthorizationAdmission.count({
        where: { workspaceId },
      });
      lockReleased = release.mock.calls.length > 0;
    }, 300_000);

    afterAll(async () => {
      if (!enabled) return;
      await prisma.fileResultWindow.deleteMany({ where: { workspaceId } });
      await prisma.fileAuthorizationAdmission.deleteMany({
        where: { workspaceId },
      });
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
      await prisma.user.deleteMany({ where: { id: ownerId } });
    });

    /**
     * The control, and the premise. The cycle reached its cleanup stage and
     * the pruner that exists did its job, so a surviving window below is
     * about the window table rather than about the route not running.
     */
    it("1. the cycle ran and the admission pruner it already calls worked", () => {
      expect(expiredAdmissionsBefore).toBe(1);
      expect(
        expiredAdmissionsAfter,
        "the expired admission survived, so the sync cycle did not reach " +
          "pruneExpiredAdmissions and nothing below can be concluded",
      ).toBe(0);
      expect(lockReleased, "the sync lock was never released").toBe(true);
    });

    /** FAILS TODAY. Measured: 2 before, 2 after. */
    it("2. a full sync cycle retires windows nothing can read again", () => {
      expect(expiredWindowsBefore).toBe(2);
      expect(
        expiredWindowsAfter,
        `${expiredWindowsAfter} of ${expiredWindowsBefore} expired result ` +
          "windows survived a complete /sync/drive-index cycle. A window " +
          "past its expiresAt is refused on read, so these rows are " +
          "unreachable; nothing in the repository deletes from " +
          "file_result_window, and the table gains a row with a full result " +
          "ordering in it for every search by every actor. The cycle already " +
          "prunes file_authorization_admission for exactly this reason.",
      ).toBe(0);
    });

    /**
     * Must pass today and after the fix. It stops the fix being a sweep that
     * deletes windows readers are still paging through.
     */
    it("3. a window still inside its life is left alone", () => {
      expect(
        liveWindowSurvived,
        "a live result window was deleted, which breaks paging",
      ).toBe(true);
    });
  },
);

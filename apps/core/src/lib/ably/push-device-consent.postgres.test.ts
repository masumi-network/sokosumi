import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import {
  beginPushActivation,
  revokePushDevice,
  subscribePushDevice,
} from "./push-device-consent";

const mocks = vi.hoisted(() => ({ save: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/db/prisma", async () => {
  const { createPrismaClient } = await import("@sokosumi/database/client");
  const connectionString = process.env.SOK939_TEST_DATABASE_URL;
  if (!connectionString)
    throw new Error(
      "Set SOK939_TEST_DATABASE_URL to the disposable local sok_939 database",
    );
  const url = new URL(connectionString);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/sok_939")
    throw new Error(
      "Push consent tests require the disposable local sok_939 database",
    );
  url.searchParams.set("application_name", "sok-939-consent-test");
  return { default: createPrismaClient(url.toString()) };
});
vi.mock("./client", () => ({
  getPushAdminRestClient: () => ({
    push: {
      admin: {
        channelSubscriptions: { save: mocks.save, remove: mocks.remove },
      },
    },
  }),
}));
vi.mock("./push-device-ownership", () => ({
  getPushDeviceChannel: (userId: string) => `notifications:all:user_${userId}`,
  getOwnedPushDevice: async (
    _client: unknown,
    userId: string,
    deviceId: string,
  ) => ({ id: deviceId, clientId: `${userId}:tab` }),
  isPushDeviceSubscribed: async () => true,
}));

let userId: string;
let channel: string;
let subscriptions: Set<string>;
function deferred() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function seedConsent(deviceId = "original") {
  return prisma.pushDeviceConsent.create({
    data: {
      userId,
      channel,
      registrations: { create: { channel, deviceId, revision: 0 } },
    },
  });
}
async function waitForBlockedAdvisoryLock() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const waiting = await prisma.$queryRaw<{ waiting: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_locks locks
        JOIN pg_stat_activity activity ON activity.pid = locks.pid
        WHERE locks.locktype = 'advisory' AND NOT locks.granted
          AND activity.application_name = 'sok-939-consent-test'
      ) AS waiting
    `;
    if (waiting[0]?.waiting) return;
    await delay(10);
  }
  throw new Error(
    "Expected a concurrent operation to wait for the consent advisory lock",
  );
}

beforeEach(async () => {
  vi.resetAllMocks();
  userId = `sok-939-test-${randomUUID()}`;
  channel = `notifications:all:user_${userId}`;
  subscriptions = new Set();
  await prisma.user.create({
    data: {
      id: userId,
      name: "Push consent test",
      email: `${userId}@example.invalid`,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  mocks.save.mockImplementation(async ({ deviceId }: { deviceId: string }) => {
    subscriptions.add(deviceId);
  });
  mocks.remove.mockImplementation(
    async ({ deviceId }: { deviceId: string }) => {
      subscriptions.delete(deviceId);
    },
  );
});
afterEach(async () => {
  // Delete only this test's fixture. The consent and alias rows cascade.
  await prisma.user.delete({ where: { id: userId } });
});
afterAll(async () => {
  await prisma.$disconnect();
});

it("holds the real advisory lock during bind so revoke waits and then removes the subscription", async () => {
  const consent = await seedConsent();
  const entered = deferred();
  const finishSave = deferred();
  mocks.save.mockImplementationOnce(
    async ({ deviceId }: { deviceId: string }) => {
      entered.release();
      await finishSave.promise;
      subscriptions.add(deviceId);
    },
  );
  const bind = subscribePushDevice(userId, "replacement", {
    consentId: consent.id,
    revision: consent.revision,
  });
  await entered.promise;
  const revoke = revokePushDevice(userId, "original");
  try {
    await waitForBlockedAdvisoryLock();
    expect(mocks.remove).not.toHaveBeenCalled();
  } finally {
    finishSave.release();
    await Promise.all([bind, revoke]);
  }
  expect(subscriptions.size).toBe(0);
  const stored = await prisma.pushDeviceConsent.findUniqueOrThrow({
    where: { id: consent.id },
  });
  expect(stored.revokedAt).toBeInstanceOf(Date);
  expect(stored.revocationCompletedAt).toBeInstanceOf(Date);
  expect(mocks.remove).toHaveBeenCalledWith({
    channel,
    deviceId: "replacement",
  });
});

it("a revoke already cleaning up blocks binding and denies it after the lock releases", async () => {
  const consent = await seedConsent();
  const entered = deferred();
  const finishRemove = deferred();
  mocks.remove.mockImplementationOnce(async () => {
    entered.release();
    await finishRemove.promise;
  });
  const revoke = revokePushDevice(userId, "original");
  await entered.promise;
  const bind = subscribePushDevice(userId, "replacement", {
    consentId: consent.id,
    revision: 0,
  });
  try {
    await waitForBlockedAdvisoryLock();
    expect(mocks.save).not.toHaveBeenCalled();
  } finally {
    finishRemove.release();
    await revoke;
  }
  expect(await bind).toBe(false);
  expect(
    await prisma.pushDeviceRegistration.findUnique({
      where: { channel_deviceId: { channel, deviceId: "replacement" } },
    }),
  ).toBeNull();
});

it("revoking a retained old alias removes its replacement registration", async () => {
  const consent = await seedConsent();
  await subscribePushDevice(userId, "replacement", {
    consentId: consent.id,
    revision: 0,
  });
  expect(subscriptions.has("replacement")).toBe(true);
  await revokePushDevice(userId, "original");
  expect(subscriptions.has("replacement")).toBe(false);
  expect(
    await prisma.pushDeviceRegistration.count({
      where: { consentId: consent.id },
    }),
  ).toBe(2);
  expect(
    await beginPushActivation(userId, {
      deviceId: "original",
      readerInitiated: false,
    }),
  ).toMatchObject({ id: consent.id, revoked: true });
});

it("failed provider removal rolls back cleanup but keeps committed revocation intent", async () => {
  const consent = await seedConsent();
  subscriptions.add("original");
  mocks.remove.mockRejectedValueOnce(new Error("simulated Ably failure"));
  await expect(revokePushDevice(userId, "original")).rejects.toMatchObject({
    status: 502,
  });
  expect(
    await prisma.pushDeviceConsent.findUniqueOrThrow({
      where: { id: consent.id },
    }),
  ).toMatchObject({
    revision: 1,
    revokedAt: expect.any(Date),
    revocationCompletedAt: null,
  });
  expect(
    await subscribePushDevice(userId, "replacement", {
      consentId: consent.id,
      revision: 0,
    }),
  ).toBe(false);
  await revokePushDevice(userId, "original");
  expect(subscriptions.size).toBe(0);
  expect(
    await prisma.pushDeviceConsent.findUniqueOrThrow({
      where: { id: consent.id },
    }),
  ).toMatchObject({ revocationCompletedAt: expect.any(Date) });
});

it("explicit re-enable advances consent and invalidates old activation requests", async () => {
  const consent = await seedConsent();
  await revokePushDevice(userId, "original");
  const enabled = await beginPushActivation(userId, {
    deviceId: "original",
    consentId: consent.id,
    readerInitiated: true,
  });
  expect(enabled).toEqual({
    id: consent.id,
    revision: 2,
    revoked: false,
    replaceDevice: true,
  });
  expect(
    await subscribePushDevice(userId, "replacement", {
      consentId: consent.id,
      revision: 0,
    }),
  ).toBe(false);
  expect(
    await subscribePushDevice(userId, "replacement", {
      consentId: consent.id,
      revision: enabled.revision,
    }),
  ).toBe(true);
  expect(subscriptions.has("replacement")).toBe(true);
});

it("late provider deletion cannot remove a re-enabled replacement device", async () => {
  const consent = await seedConsent();
  subscriptions.add("original");
  const delayedRemovals: (() => void)[] = [];
  mocks.remove.mockImplementation(
    async ({ deviceId }: { deviceId: string }) => {
      // Model Ably acknowledging DELETE before applying the subscription removal.
      delayedRemovals.push(() => {
        subscriptions.delete(deviceId);
      });
    },
  );
  await revokePushDevice(userId, "original");
  expect(subscriptions.has("original")).toBe(true);
  const enabled = await beginPushActivation(userId, {
    deviceId: "original",
    consentId: consent.id,
    readerInitiated: true,
  });
  expect(enabled.replaceDevice).toBe(true);
  expect(
    await subscribePushDevice(userId, "original", {
      consentId: consent.id,
      revision: enabled.revision,
    }),
  ).toBe(false);
  expect(
    await subscribePushDevice(userId, "replacement", {
      consentId: consent.id,
      revision: enabled.revision,
    }),
  ).toBe(true);
  for (const remove of delayedRemovals) remove();
  expect(subscriptions.has("original")).toBe(false);
  expect(subscriptions.has("replacement")).toBe(true);
  expect(
    await prisma.pushDeviceRegistration.findMany({
      where: { consentId: consent.id },
      select: { deviceId: true, revision: true },
      orderBy: { deviceId: "asc" },
    }),
  ).toEqual([
    { deviceId: "original", revision: 0 },
    { deviceId: "replacement", revision: enabled.revision },
  ]);
});

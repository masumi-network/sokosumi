import type {
  PushDeviceConsent,
  PushDeviceRegistration,
} from "@sokosumi/database";
import { beforeEach, expect, it, vi } from "vitest";
import {
  beginPushActivation,
  revokePushDevice,
  subscribePushDevice,
} from "./push-device-consent";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  lock: vi.fn(),
  consentFind: vi.fn(),
  consentCreate: vi.fn(),
  consentUpdate: vi.fn(),
  registrationFind: vi.fn(),
  registrationCreate: vi.fn(),
  registrationsFind: vi.fn(),
  owned: vi.fn(),
  subscribed: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: { $transaction: mocks.transaction },
}));
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
  getOwnedPushDevice: mocks.owned,
  isPushDeviceSubscribed: mocks.subscribed,
}));

const userId = "user-1";
const channel = "notifications:all:user_user-1";
const deviceId = "device-1";
const tx = {
  $executeRaw: mocks.lock,
  pushDeviceConsent: {
    findFirst: mocks.consentFind,
    create: mocks.consentCreate,
    update: mocks.consentUpdate,
  },
  pushDeviceRegistration: {
    findUnique: mocks.registrationFind,
    create: mocks.registrationCreate,
    findMany: mocks.registrationsFind,
  },
};
let consents: PushDeviceConsent[];
let registrations: PushDeviceRegistration[];

function seedConsent(overrides: Partial<PushDeviceConsent> = {}) {
  const consent: PushDeviceConsent = {
    id: `consent-${consents.length + 1}`,
    userId,
    channel,
    revision: 0,
    revokedAt: null,
    revocationCompletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  consents.push(consent);
  return consent;
}
function seedRegistration(consent: PushDeviceConsent, id = deviceId) {
  registrations.push({
    channel: consent.channel,
    deviceId: id,
    consentId: consent.id,
    revision: consent.revision,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  consents = [];
  registrations = [];
  mocks.transaction.mockImplementation(
    async (operation: (value: typeof tx) => Promise<unknown>) => operation(tx),
  );
  mocks.consentFind.mockImplementation(
    async ({
      where,
    }: {
      where: { id: string; userId: string; channel: string };
    }) =>
      consents.find(
        (consent) =>
          consent.id === where.id &&
          consent.userId === where.userId &&
          consent.channel === where.channel,
      ) ?? null,
  );
  mocks.consentCreate.mockImplementation(
    async ({ data }: { data: { userId: string; channel: string } }) =>
      seedConsent(data),
  );
  mocks.consentUpdate.mockImplementation(
    async ({
      where,
      data,
    }: {
      where: { id: string };
      data: {
        revision?: { increment: number };
        revokedAt?: Date | null;
        revocationCompletedAt?: Date | null;
      };
    }) => {
      const index = consents.findIndex((consent) => consent.id === where.id);
      const old = consents[index];
      const updated = {
        ...old,
        ...data,
        revision: old.revision + (data.revision?.increment ?? 0),
      };
      consents[index] = updated;
      return updated;
    },
  );
  mocks.registrationFind.mockImplementation(
    async ({
      where,
    }: {
      where: { channel_deviceId: { channel: string; deviceId: string } };
    }) => {
      const registration = registrations.find(
        (item) =>
          item.channel === where.channel_deviceId.channel &&
          item.deviceId === where.channel_deviceId.deviceId,
      );
      return registration
        ? {
            ...registration,
            consent: consents.find(
              (item) => item.id === registration.consentId,
            ),
          }
        : null;
    },
  );
  mocks.registrationCreate.mockImplementation(
    async ({ data }: { data: PushDeviceRegistration }) => {
      registrations.push(data);
      return data;
    },
  );
  mocks.registrationsFind.mockImplementation(
    async ({ where }: { where: { consentId: string; channel: string } }) =>
      registrations.filter(
        (registration) =>
          registration.consentId === where.consentId &&
          registration.channel === where.channel,
      ),
  );
  mocks.owned.mockResolvedValue({ id: deviceId, clientId: `${userId}:tab` });
  mocks.subscribed.mockResolvedValue(true);
  mocks.save.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
});

it("adopts an owned legacy device with its exact channel subscription", async () => {
  const result = await beginPushActivation(userId, {
    deviceId,
    readerInitiated: false,
  });
  expect(result).toEqual({
    id: "consent-1",
    revision: 0,
    revoked: false,
    replaceDevice: false,
  });
  expect(registrations).toEqual([
    { channel, deviceId, consentId: result.id, revision: 0 },
  ]);
  expect(mocks.subscribed).toHaveBeenCalledWith(
    expect.anything(),
    channel,
    deviceId,
  );
  expect(mocks.lock).toHaveBeenCalledTimes(1);
});
it.each(["missing or foreign", "other environment"])(
  "does not adopt %s initial devices",
  async (reason) => {
    if (reason === "missing or foreign") mocks.owned.mockResolvedValue(null);
    else mocks.subscribed.mockResolvedValue(false);
    await beginPushActivation(userId, { deviceId, readerInitiated: false });
    expect(registrations).toEqual([]);
    expect(consents).toHaveLength(1);
  },
);
it.each([{ userId: "another-user" }, { channel: "another-environment" }])(
  "rejects supplied consent outside the caller scope: %j",
  async (override) => {
    const consent = seedConsent(override);
    await expect(
      beginPushActivation(userId, {
        deviceId,
        consentId: consent.id,
        readerInitiated: true,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.consentUpdate).not.toHaveBeenCalled();
  },
);
it("rejects unknown supplied consent without creating a replacement", async () => {
  await expect(
    beginPushActivation(userId, {
      deviceId,
      consentId: "missing",
      readerInitiated: false,
    }),
  ).rejects.toMatchObject({ status: 404 });
  expect(consents).toHaveLength(0);
});
it("finds revoked consent through an old device alias without a supplied ID", async () => {
  const consent = seedConsent({ revision: 2, revokedAt: new Date() });
  seedRegistration(consent);
  const result = await beginPushActivation(userId, {
    deviceId,
    readerInitiated: false,
  });
  expect(result).toEqual({
    id: consent.id,
    revision: 2,
    revoked: true,
    replaceDevice: false,
  });
  expect(mocks.consentUpdate).not.toHaveBeenCalled();
});
it("rejects a supplied ID that disagrees with the device alias", async () => {
  const consent = seedConsent();
  seedRegistration(consent);
  const other = seedConsent();
  await expect(
    beginPushActivation(userId, {
      deviceId,
      consentId: other.id,
      readerInitiated: true,
    }),
  ).rejects.toMatchObject({ status: 404 });
  expect(mocks.consentUpdate).not.toHaveBeenCalled();
});
it("explicit activation advances the revision and clears completed revocation", async () => {
  const consent = seedConsent({
    revision: 3,
    revokedAt: new Date(),
    revocationCompletedAt: new Date(),
  });
  seedRegistration(consent);
  expect(
    await beginPushActivation(userId, { deviceId, readerInitiated: true }),
  ).toEqual({
    id: consent.id,
    revision: 4,
    revoked: false,
    replaceDevice: true,
  });
  expect(consents[0].revocationCompletedAt).toBeNull();
});
it("commits the alias before subscribing, and locks both phases", async () => {
  const consent = seedConsent();
  mocks.save.mockImplementation(async () => {
    expect(registrations).toEqual([
      { channel, deviceId, consentId: consent.id, revision: 0 },
    ]);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
  });
  expect(
    await subscribePushDevice(userId, deviceId, {
      consentId: consent.id,
      revision: 0,
    }),
  ).toBe(true);
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ channel, deviceId });
  expect(mocks.lock).toHaveBeenCalledTimes(2);
});
it.each([{ revokedAt: new Date() }, { revision: 1 }])(
  "rejects stale subscription before touching Ably: %j",
  async (override) => {
    const consent = seedConsent(override);
    expect(
      await subscribePushDevice(userId, deviceId, {
        consentId: consent.id,
        revision: 0,
      }),
    ).toBe(false);
    expect(mocks.owned).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  },
);
it("does not bind foreign provider registrations", async () => {
  const consent = seedConsent();
  mocks.owned.mockResolvedValue(null);
  await expect(
    subscribePushDevice(userId, deviceId, {
      consentId: consent.id,
      revision: 0,
    }),
  ).rejects.toMatchObject({ status: 404 });
  expect(registrations).toEqual([]);
  expect(mocks.save).not.toHaveBeenCalled();
});
it("never reparents an existing alias", async () => {
  seedRegistration(seedConsent());
  const other = seedConsent();
  await expect(
    subscribePushDevice(userId, deviceId, { consentId: other.id, revision: 0 }),
  ).rejects.toMatchObject({ status: 404 });
  expect(registrations[0].consentId).toBe("consent-1");
  expect(mocks.save).not.toHaveBeenCalled();
});
it("rechecks consent if revocation happens after alias commit", async () => {
  const consent = seedConsent();
  mocks.transaction.mockImplementationOnce(
    async (operation: (value: typeof tx) => Promise<unknown>) => {
      const result = await operation(tx);
      consents[0] = { ...consents[0], revokedAt: new Date(), revision: 1 };
      return result;
    },
  );
  expect(
    await subscribePushDevice(userId, deviceId, {
      consentId: consent.id,
      revision: 0,
    }),
  ).toBe(false);
  expect(registrations).toHaveLength(1);
  expect(mocks.save).not.toHaveBeenCalled();
});
it("retains the committed alias when provider binding fails", async () => {
  const consent = seedConsent();
  mocks.save.mockRejectedValue(new Error("provider secret"));
  await expect(
    subscribePushDevice(userId, deviceId, {
      consentId: consent.id,
      revision: 0,
    }),
  ).rejects.toMatchObject({
    status: 502,
    message: "Unable to subscribe push device",
  });
  expect(registrations).toHaveLength(1);
});
it("revokes all replacement aliases on the exact channel", async () => {
  const consent = seedConsent();
  seedRegistration(consent);
  seedRegistration(consent, "replacement");
  mocks.remove.mockImplementation(async () => {
    expect(consents[0].revokedAt).toBeInstanceOf(Date);
    expect(consents[0].revocationCompletedAt).toBeNull();
  });
  await revokePushDevice(userId, deviceId);
  expect(mocks.remove.mock.calls).toEqual([
    [{ channel, deviceId }],
    [{ channel, deviceId: "replacement" }],
  ]);
  expect(consents[0].revocationCompletedAt).toBeInstanceOf(Date);
  expect(mocks.owned).not.toHaveBeenCalled();
});
it("adopts and revokes legacy devices", async () => {
  await revokePushDevice(userId, deviceId);
  expect(registrations).toHaveLength(1);
  expect(consents[0].revokedAt).toBeInstanceOf(Date);
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith({ channel, deviceId });
});
it.each(["foreign or missing", "other environment"])(
  "rejects legacy revoke for %s devices",
  async (reason) => {
    if (reason === "foreign or missing") mocks.owned.mockResolvedValue(null);
    else mocks.subscribed.mockResolvedValue(false);
    await expect(revokePushDevice(userId, deviceId)).rejects.toMatchObject({
      status: 404,
    });
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(consents).toEqual([]);
  },
);
it("rejects an alias whose consent belongs to another user", async () => {
  seedRegistration(seedConsent({ userId: "another-user" }));
  await expect(revokePushDevice(userId, deviceId)).rejects.toMatchObject({
    status: 404,
  });
  expect(mocks.remove).not.toHaveBeenCalled();
});
it("retains revocation intent after provider failure and retries cleanup", async () => {
  const consent = seedConsent();
  seedRegistration(consent);
  mocks.remove.mockRejectedValueOnce(new Error("provider secret"));
  await expect(revokePushDevice(userId, deviceId)).rejects.toMatchObject({
    status: 502,
    message: "Unable to revoke push device",
  });
  expect(consents[0].revokedAt).toBeInstanceOf(Date);
  expect(consents[0].revocationCompletedAt).toBeNull();
  expect(
    await beginPushActivation(userId, { deviceId, readerInitiated: false }),
  ).toMatchObject({ revoked: true });
  await revokePushDevice(userId, deviceId);
  expect(mocks.remove).toHaveBeenCalledTimes(2);
  expect(consents[0].revocationCompletedAt).toBeInstanceOf(Date);
});
it("does not apply stale cleanup after explicit activation wins", async () => {
  const consent = seedConsent();
  seedRegistration(consent);
  mocks.transaction.mockImplementationOnce(
    async (operation: (value: typeof tx) => Promise<unknown>) => {
      const result = await operation(tx);
      await beginPushActivation(userId, { deviceId, readerInitiated: true });
      return result;
    },
  );
  await revokePushDevice(userId, deviceId);
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(consents[0]).toMatchObject({
    revision: 2,
    revokedAt: null,
    revocationCompletedAt: null,
  });
});
it("cleans the latest revoked revision when an overlapping revoke cleanup fails", async () => {
  seedRegistration(seedConsent());
  let subscribed = true;
  mocks.remove
    .mockRejectedValueOnce(new Error("second revoke provider failure"))
    .mockImplementationOnce(async () => {
      subscribed = false;
    });
  mocks.transaction.mockImplementationOnce(
    async (operation: (value: typeof tx) => Promise<unknown>) => {
      const firstIntent = await operation(tx);
      // The second request commits a newer intent before the first request's
      // cleanup starts. Its provider failure must not turn the first into a
      // successful no-op while the subscription still exists.
      await expect(revokePushDevice(userId, deviceId)).rejects.toMatchObject({
        status: 502,
      });
      return firstIntent;
    },
  );
  await revokePushDevice(userId, deviceId);
  expect(mocks.remove).toHaveBeenCalledTimes(2);
  expect(subscribed).toBe(false);
  expect(consents[0]).toMatchObject({
    revision: 2,
    revokedAt: expect.any(Date),
    revocationCompletedAt: expect.any(Date),
  });
});
it("retires old aliases when explicit activation advances consent", async () => {
  const consent = seedConsent();
  seedRegistration(consent);
  await revokePushDevice(userId, deviceId);
  const enabled = await beginPushActivation(userId, {
    deviceId,
    consentId: consent.id,
    readerInitiated: true,
  });
  expect(enabled).toMatchObject({ revision: 2, replaceDevice: true });
  expect(
    await subscribePushDevice(userId, deviceId, {
      consentId: consent.id,
      revision: enabled.revision,
    }),
  ).toBe(false);
  expect(mocks.save).not.toHaveBeenCalled();
  expect(
    await subscribePushDevice(userId, "replacement", {
      consentId: consent.id,
      revision: enabled.revision,
    }),
  ).toBe(true);
  expect(registrations).toEqual([
    { channel, deviceId, consentId: consent.id, revision: 0 },
    { channel, deviceId: "replacement", consentId: consent.id, revision: 2 },
  ]);
  expect(
    await beginPushActivation(userId, {
      deviceId,
      consentId: consent.id,
      readerInitiated: false,
    }),
  ).toMatchObject({ revoked: false, replaceDevice: true });
});

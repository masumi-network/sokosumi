import type { Prisma } from "@sokosumi/database";
import { badGateway, notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { getPushAdminRestClient } from "./client";
import {
  getOwnedPushDevice,
  getPushDeviceChannel,
  isPushDeviceSubscribed,
} from "./push-device-ownership";

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 60_000 };

interface ActivationInput {
  consentId?: string;
  deviceId: string;
  readerInitiated: boolean;
}

interface SubscriptionInput {
  consentId: string;
  revision: number;
}

function withConsentLock<T>(
  userId: string,
  channel: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const key = `push-consent:${userId}:${channel}`;
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${key}::TEXT, 0))
    `;
    return operation(tx);
  }, TRANSACTION_OPTIONS);
}

export async function beginPushActivation(
  userId: string,
  input: ActivationInput,
): Promise<{
  id: string;
  revision: number;
  revoked: boolean;
  replaceDevice: boolean;
}> {
  const channel = getPushDeviceChannel(userId);
  return withConsentLock(userId, channel, async (tx) => {
    const registration = await tx.pushDeviceRegistration.findUnique({
      where: { channel_deviceId: { channel, deviceId: input.deviceId } },
      include: { consent: true },
    });
    if (
      registration &&
      (registration.consent.userId !== userId ||
        registration.consent.channel !== channel ||
        (input.consentId && input.consentId !== registration.consentId))
    )
      throw notFound("Push device not found");

    let consent = registration?.consent;
    if (!consent && input.consentId) {
      consent =
        (await tx.pushDeviceConsent.findFirst({
          where: { id: input.consentId, userId, channel },
        })) ?? undefined;
      if (!consent) throw notFound("Push device not found");
    }
    if (!consent) {
      consent = await tx.pushDeviceConsent.create({
        data: { userId, channel },
      });
    } else if (input.readerInitiated) {
      consent = await tx.pushDeviceConsent.update({
        where: { id: consent.id },
        data: {
          revision: { increment: 1 },
          revokedAt: null,
          revocationCompletedAt: null,
        },
      });
    }

    // Adopt legacy registrations only after checking both provider ownership and
    // the exact environment subscription. Fresh devices bind after activation.
    if (!registration) {
      const client = getPushAdminRestClient();
      if (
        (await getOwnedPushDevice(client, userId, input.deviceId)) &&
        (await isPushDeviceSubscribed(client, channel, input.deviceId))
      ) {
        await tx.pushDeviceRegistration.create({
          data: {
            channel,
            deviceId: input.deviceId,
            consentId: consent.id,
            revision: consent.revision,
          },
        });
      }
    }
    return {
      id: consent.id,
      revision: consent.revision,
      revoked: consent.revokedAt !== null,
      replaceDevice: Boolean(
        registration && registration.revision !== consent.revision,
      ),
    };
  });
}

export async function subscribePushDevice(
  userId: string,
  deviceId: string,
  input: SubscriptionInput,
): Promise<boolean> {
  const channel = getPushDeviceChannel(userId);
  const client = getPushAdminRestClient();
  const bound = await withConsentLock(userId, channel, async (tx) => {
    const consent = await tx.pushDeviceConsent.findFirst({
      where: { id: input.consentId, userId, channel },
    });
    if (!consent) throw notFound("Push device not found");
    if (consent.revokedAt || consent.revision !== input.revision) return false;
    if (!(await getOwnedPushDevice(client, userId, deviceId)))
      throw notFound("Push device not found");
    const registration = await tx.pushDeviceRegistration.findUnique({
      where: { channel_deviceId: { channel, deviceId } },
    });
    if (registration && registration.consentId !== consent.id)
      throw notFound("Push device not found");
    // Ably may finish deleting old subscriptions after its HTTP response.
    // Never reuse an alias from an earlier consent revision.
    if (registration && registration.revision !== consent.revision)
      return false;
    if (!registration) {
      // Commit the alias before Ably sees a subscription. Revocation can then
      // clean up this device even if the later provider request times out.
      await tx.pushDeviceRegistration.create({
        data: {
          channel,
          deviceId,
          consentId: consent.id,
          revision: consent.revision,
        },
      });
    }
    return true;
  });
  if (!bound) return false;

  return withConsentLock(userId, channel, async (tx) => {
    const consent = await tx.pushDeviceConsent.findFirst({
      where: { id: input.consentId, userId, channel },
    });
    if (!consent) throw notFound("Push device not found");
    if (consent.revokedAt || consent.revision !== input.revision) return false;
    await client.push.admin.channelSubscriptions
      .save({ channel, deviceId })
      .catch(() => {
        throw badGateway("Unable to subscribe push device");
      });
    return true;
  });
}

export async function revokePushDevice(
  userId: string,
  deviceId: string,
): Promise<void> {
  const channel = getPushDeviceChannel(userId);
  const client = getPushAdminRestClient();
  const revoked = await withConsentLock(userId, channel, async (tx) => {
    const registration = await tx.pushDeviceRegistration.findUnique({
      where: { channel_deviceId: { channel, deviceId } },
      include: { consent: true },
    });
    let consent = registration?.consent;
    if (consent && (consent.userId !== userId || consent.channel !== channel))
      throw notFound("Push device not found");
    if (!consent) {
      if (
        !(await getOwnedPushDevice(client, userId, deviceId)) ||
        !(await isPushDeviceSubscribed(client, channel, deviceId))
      )
        throw notFound("Push device not found");
      consent = await tx.pushDeviceConsent.create({
        data: { userId, channel },
      });
      await tx.pushDeviceRegistration.create({
        data: {
          channel,
          deviceId,
          consentId: consent.id,
          revision: consent.revision,
        },
      });
    }
    // Commit intent first. A provider failure must never restore permission.
    return tx.pushDeviceConsent.update({
      where: { id: consent.id },
      data: {
        revision: { increment: 1 },
        revokedAt: new Date(),
        revocationCompletedAt: null,
      },
    });
  });

  await withConsentLock(userId, channel, async (tx) => {
    const consent = await tx.pushDeviceConsent.findFirst({
      where: { id: revoked.id, userId, channel },
    });
    // Preserve an explicit activation, but clean the latest revoked intent.
    // Another revoke may have advanced the revision and then failed cleanup.
    if (!consent?.revokedAt) return;
    const registrations = await tx.pushDeviceRegistration.findMany({
      where: { consentId: consent.id, channel },
    });
    for (const registration of registrations) {
      await client.push.admin.channelSubscriptions
        .remove({ channel, deviceId: registration.deviceId })
        .catch(() => {
          throw badGateway("Unable to revoke push device");
        });
    }
    await tx.pushDeviceConsent.update({
      where: { id: consent.id },
      data: { revocationCompletedAt: new Date() },
    });
  });
}

import * as Sentry from "@sentry/node";
import type { PrismaClient } from "@sokosumi/database";
import { userRepository } from "@sokosumi/database/repositories";

import { stripeClient } from "@/clients/stripe.client";
import prisma from "@/lib/db/prisma";

const pendingStripeEmailSyncUserIds = new Set<string>();
const pendingStripeEmailSyncByNormalizedEmail = new Set<string>();

export function resetStripeEmailSyncStateForTests(): void {
  pendingStripeEmailSyncUserIds.clear();
  pendingStripeEmailSyncByNormalizedEmail.clear();
}

function resolveDatabaseHookUserId(
  ctx: unknown,
  updateData: Record<string, unknown>,
): string | null {
  if (typeof updateData.id === "string") {
    return updateData.id;
  }

  if (!ctx || typeof ctx !== "object") {
    return null;
  }

  const record = ctx as Record<string, unknown>;
  const nestedContext =
    record.context && typeof record.context === "object"
      ? (record.context as Record<string, unknown>)
      : null;

  const sessionCandidate =
    record.session ??
    nestedContext?.session ??
    nestedContext?.newSession ??
    null;

  if (!sessionCandidate || typeof sessionCandidate !== "object") {
    return null;
  }

  const user = (sessionCandidate as Record<string, unknown>).user;
  if (user && typeof user === "object" && typeof user.id === "string") {
    return user.id;
  }

  return null;
}

export function markPendingStripeEmailSyncForUserUpdate(
  updateData: Record<string, unknown>,
  userId: string | null,
  existingEmail: string | null,
): void {
  if (
    !Object.hasOwn(updateData, "email") ||
    typeof updateData.email !== "string"
  ) {
    return;
  }

  const normalizedNewEmail = updateData.email.toLowerCase();
  if (existingEmail && existingEmail.toLowerCase() === normalizedNewEmail) {
    return;
  }

  if (userId) {
    pendingStripeEmailSyncUserIds.add(userId);
    return;
  }

  pendingStripeEmailSyncByNormalizedEmail.add(normalizedNewEmail);
}

function consumePendingStripeEmailSync(user: {
  id: string;
  email: string;
}): boolean {
  const normalizedEmail = user.email.toLowerCase();
  let shouldSync = false;

  if (pendingStripeEmailSyncUserIds.has(user.id)) {
    pendingStripeEmailSyncUserIds.delete(user.id);
    shouldSync = true;
  }

  if (pendingStripeEmailSyncByNormalizedEmail.has(normalizedEmail)) {
    pendingStripeEmailSyncByNormalizedEmail.delete(normalizedEmail);
    shouldSync = true;
  }

  return shouldSync;
}

export async function prepareStripeEmailSyncForUserUpdate(
  updateData: Record<string, unknown>,
  ctx: unknown,
  prisma: PrismaClient,
): Promise<void> {
  if (
    !Object.hasOwn(updateData, "email") ||
    typeof updateData.email !== "string"
  ) {
    return;
  }

  const userId = resolveDatabaseHookUserId(ctx, updateData);
  const existingEmail = userId
    ? ((await userRepository.getUserById(userId, prisma))?.email ?? null)
    : null;

  markPendingStripeEmailSyncForUserUpdate(updateData, userId, existingEmail);
}

export async function handleUserUpdateStripeEmailSync(user: {
  id: string;
  email: string;
}): Promise<void> {
  if (!consumePendingStripeEmailSync(user)) {
    return;
  }

  await syncUserEmailWithStripe(user.id, user.email);
}

export async function syncUserEmailWithStripe(
  userId: string,
  newEmail: string,
): Promise<void> {
  try {
    const user = await userRepository.getUserById(userId, prisma);

    if (!user?.stripeCustomerId) {
      return;
    }

    await stripeClient.updateCustomerEmail(user.stripeCustomerId, newEmail);
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        context: "stripe_user_email_sync",
      },
      extra: {
        userId,
      },
    });
  }
}

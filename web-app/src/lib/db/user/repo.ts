"use server";

import { prisma } from "@/lib/db";
import { Prisma, User } from "@/prisma/generated/client";

export async function getUserByEmail(
  email: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<User | null> {
  return await tx.user.findUnique({
    where: { email },
  });
}

export async function getUserById(
  id: string,
  tx: Prisma.TransactionClient = prisma,
) {
  return await tx.user.findUnique({
    where: { id },
  });
}

export async function setUserMarketingOptIn(
  userId: string,
  marketingOptIn: boolean,
  tx: Prisma.TransactionClient = prisma,
): Promise<User> {
  return await tx.user.update({
    where: { id: userId },
    data: { marketingOptIn },
  });
}

export async function setStripeCustomerId(
  userId: string,
  stripeCustomerId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<User> {
  return await tx.user.update({
    where: { id: userId },
    data: { stripeCustomerId },
  });
}

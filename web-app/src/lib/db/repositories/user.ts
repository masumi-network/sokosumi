import "server-only";

import { Prisma, User } from "@/prisma/generated/client";

import prisma from "./prisma";

export async function retrieveUserByEmail(
  email: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<User | null> {
  return await tx.user.findUnique({
    where: { email },
  });
}

export async function retrieveUserById(
  id: string,
  tx: Prisma.TransactionClient = prisma,
) {
  return await tx.user.findUnique({
    where: { id },
  });
}

export async function updateUserStripeCustomerId(
  userId: string,
  stripeCustomerId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<User> {
  return await tx.user.update({
    where: { id: userId },
    data: { stripeCustomerId },
  });
}

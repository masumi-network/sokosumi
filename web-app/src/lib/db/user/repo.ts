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
): Promise<User | null> {
  return await tx.user.findUnique({
    where: { id },
  });
}

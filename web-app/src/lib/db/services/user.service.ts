"use server";

import prisma from "@/lib/db/prisma";
import { Prisma, User } from "@/prisma/generated/client";

export async function getUserByEmail(
  email: string,
  tx?: Prisma.TransactionClient,
): Promise<User | null> {
  return await (tx ?? prisma).user.findUnique({
    where: { email },
  });
}

export async function getUserById(
  id: string,
  tx?: Prisma.TransactionClient,
): Promise<User | null> {
  return await (tx ?? prisma).user.findUnique({
    where: { id },
  });
}

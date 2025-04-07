import { User } from "@prisma/client";

import prisma from "@/lib/db/prisma";

import { formatCreditsForDisplay } from "./credit.service";

export async function getUserByEmail(email: string): Promise<User | null> {
  return await prisma.user.findUnique({
    where: { email },
  });
}

export async function getUserById(id: string): Promise<User | null> {
  return await prisma.user.findUnique({
    where: { id },
  });
}

export async function getUserCredits(id: string): Promise<number> {
  const result = await prisma.creditTransaction.aggregate({
    where: {
      userId: id,
    },
    _sum: {
      amount: true,
    },
  });
  return formatCreditsForDisplay(result._sum.amount ?? BigInt(0));
}

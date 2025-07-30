import "server-only";

import { Prisma, User } from "@/prisma/generated/client";

import prisma from "./prisma";

export const userRepository = {
  getUserById: async (
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<User | null> => {
    const client = tx ?? prisma;
    return await client.user.findUnique({
      where: { id },
    });
  },

  getUserByEmail: async (
    email: string,
    tx?: Prisma.TransactionClient,
  ): Promise<User | null> => {
    const client = tx ?? prisma;
    return await client.user.findUnique({
      where: { email },
    });
  },

  setUserStripeCustomerId: async (
    userId: string,
    stripeCustomerId: string | null,
    tx?: Prisma.TransactionClient,
  ): Promise<User> => {
    const client = tx ?? prisma;
    return await client.user.update({
      where: { id: userId },
      data: { stripeCustomerId },
    });
  },
};

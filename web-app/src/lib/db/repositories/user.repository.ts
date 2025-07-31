import prisma from "@/lib/db/repositories/prisma";
import { Prisma, User } from "@/prisma/generated/client";

export const userRepository = {
  getUserById: async (
    id: string,
    client: Prisma.TransactionClient = prisma,
  ): Promise<User | null> => {
    return client.user.findUnique({ where: { id } });
  },

  getUserByEmail: async (
    email: string,
    client: Prisma.TransactionClient = prisma,
  ): Promise<User | null> => {
    return client.user.findUnique({ where: { email } });
  },

  setUserStripeCustomerId: async (
    userId: string,
    stripeCustomerId: string | null,
    client: Prisma.TransactionClient = prisma,
  ): Promise<User> => {
    return client.user.update({
      where: { id: userId },
      data: { stripeCustomerId },
    });
  },
};

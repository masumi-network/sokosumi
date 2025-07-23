import "server-only";

import { getSessionOrThrow } from "@/lib/auth/utils";
import prisma from "@/lib/db/repositories/prisma";
import { Prisma, User } from "@/prisma/generated/client";

export class UserService {
  constructor(protected client: Prisma.TransactionClient = prisma) {}

  async getMe(): Promise<User | null> {
    const session = await getSessionOrThrow();
    return this.client.user.findUnique({ where: { id: session.user.id } });
  }

  async getUserById(id: string): Promise<User | null> {
    return this.client.user.findUnique({ where: { id } });
  }

  async setUserStripeCustomerId(
    email: string,
    stripeCustomerId: string | null,
  ): Promise<User> {
    return this.client.user.update({
      where: { email },
      data: { stripeCustomerId },
    });
  }
}

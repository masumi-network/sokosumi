import { getSessionOrThrow } from "@/lib/auth/utils";
import { Prisma, User } from "@/prisma/generated/client";

export class UserService {
  constructor(protected prisma: Prisma.TransactionClient = prisma) {}

  async getMe(): Promise<User | null> {
    const session = await getSessionOrThrow();
    return this.prisma.user.findUnique({ where: { id: session.user.id } });
  }

  async getUserById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async setUserStripeCustomerId(
    email: string,
    stripeCustomerId: string | null,
  ): Promise<User> {
    return this.prisma.user.update({
      where: { email },
      data: { stripeCustomerId },
    });
  }
}

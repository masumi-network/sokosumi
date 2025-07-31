import "server-only";

import { getSession } from "@/lib/auth/utils";
import { userRepository } from "@/lib/db/repositories";
import { User } from "@/prisma/generated/client";

export const userService = {
  getMe: async (): Promise<User | null> => {
    const session = await getSession();
    if (!session?.user) return null;
    return userRepository.getUserById(session.user.id);
  },
};

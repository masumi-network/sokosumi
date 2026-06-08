import "server-only";

import { userRepository } from "@sokosumi/database/repositories";

import prisma from "@/lib/db/prisma";

export interface AdminUserOption {
  id: string;
  name: string;
  email: string;
}

const SEARCH_LIMIT = 20;

export const adminUserService = {
  async searchUsers(query: string): Promise<AdminUserOption[]> {
    const users = await userRepository.searchUsers(query, SEARCH_LIMIT, prisma);

    return users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
    }));
  },
};

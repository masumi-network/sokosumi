import "server-only";

import { coreClient } from "@/lib/clients/core.client";

export interface AdminUserOption {
  id: string;
  name: string;
  email: string;
}

export const adminUserService = {
  async searchUsers(query: string): Promise<AdminUserOption[]> {
    const result = await coreClient.searchAdminUsers(query);

    return result.data.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
    }));
  },
};

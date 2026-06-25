import "server-only";

import { coreClient } from "@/lib/clients/core.client";

export interface AdminUserOption {
  id: string;
  name: string;
  email: string;
}

/** A user row in the admin user overview list. */
export interface AdminUserOverviewItem {
  id: string;
  name: string;
  email: string;
  /** Registration date. */
  createdAt: Date;
  /** Available personal credits. */
  credits: number;
  subscriptionPlan: string | null;
  subscriptionStatus: string | null;
  /** Number of tasks the user has started (status beyond DRAFT). */
  startedTaskCount: number;
}

export interface AdminUserOverviewPage {
  users: AdminUserOverviewItem[];
  total: number;
  nextCursor: string | null;
}

export interface ListAdminUsersParams {
  query?: string;
  cursor?: string;
  limit?: number;
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

  async listUsers(
    params: ListAdminUsersParams = {},
  ): Promise<AdminUserOverviewPage> {
    const result = await coreClient.listAdminUsers(params);

    return {
      users: result.data.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
        credits: user.credits,
        subscriptionPlan: user.subscriptionPlan,
        subscriptionStatus: user.subscriptionStatus,
        startedTaskCount: user.startedTaskCount,
      })),
      total: result.meta.pagination.total,
      nextCursor: result.meta.pagination.nextCursor,
    };
  },
};

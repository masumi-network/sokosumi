import "server-only";

import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";

export interface AdminOrganizationOption {
  id: string;
  name: string;
  slug: string;
}

export interface AdminOrganizationOverviewItem {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  memberCount: number;
  billingMode: "enterprise_contract" | "self_serve";
  billingPlan: "free" | "starter" | "standard" | "pro" | "enterprise";
  purchasedSeats: number;
  subscriptionPlan: string | null;
  subscriptionStatus: string | null;
}

export interface AdminOrganizationOverviewPage {
  organizations: AdminOrganizationOverviewItem[];
  total: number;
  nextCursor: string | null;
}

export interface AdminOrganizationMemberOverviewItem {
  id: string;
  organizationId: string;
  role: "owner" | "admin" | "member";
  seatAssignedAt: Date | null;
  createdAt: Date;
  user: {
    id: string;
    name: string;
    email: string;
  };
  lastSeenAt: Date | null;
  credits: number;
  subscriptionPlan: string | null;
  subscriptionStatus: string | null;
}

export interface AdminOrganizationOverviewDetail {
  organization: {
    id: string;
    name: string;
    slug: string;
    createdAt: Date;
    stripeCustomerId: string | null;
  };
  billingPlan: {
    mode: "enterprise_contract" | "self_serve";
    plan: "free" | "starter" | "standard" | "pro" | "enterprise";
    isConsumable: boolean;
    purchasedSeats: number;
    cancelAtPeriodEnd: boolean;
    periodEnd: Date | null;
  };
  subscription: {
    plan: string;
    status: string;
    cancelAtPeriodEnd: boolean;
    periodStart: Date | null;
    periodEnd: Date | null;
    seats: number;
  } | null;
  enterpriseContract: {
    poolRemainingCredits: number;
    monthlyCredits: number | null;
    purchasedSeats: number;
    isConsumable: boolean;
  } | null;
  seatSummary: {
    assignedCount: number;
    memberCount: number;
    purchasedSeats: number;
    unusedSeats: number;
    paidPlan: string | null;
    isEnterpriseContract: boolean;
  };
  totalCredits: number | null;
  externalChannels: Array<{
    id: string;
    name: string;
    slug: string;
  }>;
}

export interface AdminOrganizationMemberOverviewPage {
  members: AdminOrganizationMemberOverviewItem[];
  total: number;
  nextCursor: string | null;
}

export interface ListAdminOrganizationMembersParams {
  cursor?: string;
  limit?: number;
}

export interface ListAdminOrganizationsParams {
  query?: string;
  cursor?: string;
  limit?: number;
}

export const adminOrganizationService = {
  async searchOrganizations(query: string): Promise<AdminOrganizationOption[]> {
    const result = await coreClient.searchAdminOrganizations(query);

    return result.data.map((organization) => ({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    }));
  },

  async getOrganizationOptionBySlug(
    slug: string,
  ): Promise<AdminOrganizationOption | null> {
    const result = await coreClient.searchAdminOrganizations(slug);
    const organization = result.data
      .map((item) => ({
        id: item.id,
        name: item.name,
        slug: item.slug,
      }))
      .find((option) => option.slug === slug);

    return organization ?? null;
  },

  async listOrganizations(
    params: ListAdminOrganizationsParams = {},
  ): Promise<AdminOrganizationOverviewPage> {
    const result = await coreClient.listAdminOrganizations(params);

    return {
      organizations: result.data.map((organization) => ({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        createdAt: organization.createdAt,
        memberCount: organization.memberCount,
        billingMode: organization.billingMode,
        billingPlan: organization.billingPlan,
        purchasedSeats: organization.purchasedSeats,
        subscriptionPlan: organization.subscriptionPlan,
        subscriptionStatus: organization.subscriptionStatus,
      })),
      total: result.meta.pagination.total,
      nextCursor: result.meta.pagination.nextCursor,
    };
  },

  async getOrganizationOverview(
    slug: string,
  ): Promise<AdminOrganizationOverviewDetail | null> {
    try {
      const result = await coreClient.getAdminOrganizationBySlug(slug);
      const detail = result.data;

      return {
        organization: detail.organization,
        billingPlan: detail.billingPlan,
        subscription: detail.subscription,
        enterpriseContract: detail.enterpriseContract,
        seatSummary: detail.seatSummary,
        totalCredits: detail.totalCredits,
        externalChannels: detail.externalChannels,
      };
    } catch (error) {
      if (error instanceof CoreApiRequestError && error.status === 404) {
        return null;
      }

      throw error;
    }
  },

  async listOrganizationMembers(
    slug: string,
    params: ListAdminOrganizationMembersParams = {},
  ): Promise<AdminOrganizationMemberOverviewPage> {
    const result = await coreClient.listAdminOrganizationMembers(slug, params);

    return {
      members: result.data.map((member) => ({
        id: member.id,
        organizationId: member.organizationId,
        role: member.role,
        seatAssignedAt: member.seatAssignedAt,
        createdAt: member.createdAt,
        user: member.user,
        lastSeenAt: member.lastSeenAt,
        credits: member.credits,
        subscriptionPlan: member.subscriptionPlan,
        subscriptionStatus: member.subscriptionStatus,
      })),
      total: result.meta.pagination.total,
      nextCursor: result.meta.pagination.nextCursor,
    };
  },
};

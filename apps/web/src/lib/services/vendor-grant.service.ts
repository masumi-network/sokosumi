import "server-only";

import { coreClient } from "@/lib/clients/core.client";
import type { Coworker, VendorGrant } from "@/lib/clients/generated/core";

export type ListVendorGrantsFilters = {
  status?: VendorGrant["status"];
  vendorId?: string;
};

export const vendorGrantService = (() => {
  async function listVendorGrants(
    organizationId: string,
    filters: ListVendorGrantsFilters = {},
  ): Promise<VendorGrant[]> {
    const { data } = await coreClient.getOrganizationVendorGrants(
      organizationId,
      filters,
    );
    return data;
  }

  async function createVendorGrant(
    organizationId: string,
    vendorId: string,
  ): Promise<VendorGrant> {
    const { data } = await coreClient.createOrganizationVendorGrant(
      organizationId,
      { vendorId },
    );
    return data;
  }

  async function approveVendorGrant(
    organizationId: string,
    grantId: string,
  ): Promise<VendorGrant> {
    const { data } = await coreClient.approveOrganizationVendorGrant(
      organizationId,
      grantId,
    );
    return data;
  }

  async function denyVendorGrant(
    organizationId: string,
    grantId: string,
  ): Promise<VendorGrant> {
    const { data } = await coreClient.denyOrganizationVendorGrant(
      organizationId,
      grantId,
    );
    return data;
  }

  async function revokeVendorGrant(
    organizationId: string,
    grantId: string,
  ): Promise<VendorGrant> {
    const { data } = await coreClient.revokeOrganizationVendorGrant(
      organizationId,
      grantId,
    );
    return data;
  }

  async function listMyVendorGrants(
    filters: ListVendorGrantsFilters = {},
  ): Promise<VendorGrant[]> {
    const { data } = await coreClient.getMyVendorGrants(filters);
    return data;
  }

  async function createMyVendorGrant(vendorId: string): Promise<VendorGrant> {
    const { data } = await coreClient.createMyVendorGrant({ vendorId });
    return data;
  }

  async function approveMyVendorGrant(grantId: string): Promise<VendorGrant> {
    const { data } = await coreClient.approveMyVendorGrant(grantId);
    return data;
  }

  async function denyMyVendorGrant(grantId: string): Promise<VendorGrant> {
    const { data } = await coreClient.denyMyVendorGrant(grantId);
    return data;
  }

  async function revokeMyVendorGrant(grantId: string): Promise<VendorGrant> {
    const { data } = await coreClient.revokeMyVendorGrant(grantId);
    return data;
  }

  async function resolvePendingVendorGrantForTask(params: {
    taskStatus: string;
    coworkerId: string | null;
    workspaceId: string;
    organizationId: string | null;
    coworkers: Coworker[];
  }): Promise<VendorGrant | null> {
    if (params.taskStatus !== "GRANT_PENDING" || !params.coworkerId) {
      return null;
    }

    const coworker = params.coworkers.find(
      (entry) => entry.id === params.coworkerId,
    );
    if (!coworker) {
      return null;
    }

    const filters: ListVendorGrantsFilters = {
      status: "PENDING",
      vendorId: coworker.vendor.id,
    };

    const grants = params.organizationId
      ? await listVendorGrants(params.organizationId, filters)
      : await listMyVendorGrants(filters);

    return (
      grants.find((grant) => grant.workspaceId === params.workspaceId) ?? null
    );
  }

  return {
    listVendorGrants,
    createVendorGrant,
    approveVendorGrant,
    denyVendorGrant,
    revokeVendorGrant,
    listMyVendorGrants,
    createMyVendorGrant,
    approveMyVendorGrant,
    denyMyVendorGrant,
    revokeMyVendorGrant,
    resolvePendingVendorGrantForTask,
  };
})();

import "server-only";

import { coreClient } from "@/lib/clients/core.client";
import type { VendorGrant } from "@/lib/clients/generated/core";

export type VendorGrantPermission = VendorGrant["permission"];

export type ListVendorGrantsFilters = {
  status?: VendorGrant["status"];
  vendorId?: string;
  permission?: VendorGrantPermission;
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
    permission: VendorGrantPermission,
  ): Promise<VendorGrant> {
    const { data } = await coreClient.createOrganizationVendorGrant(
      organizationId,
      { vendorId, permission },
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

  async function createMyVendorGrant(
    vendorId: string,
    permission: VendorGrantPermission,
  ): Promise<VendorGrant> {
    const { data } = await coreClient.createMyVendorGrant({
      vendorId,
      permission,
    });
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
  };
})();

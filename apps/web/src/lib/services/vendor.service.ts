import "server-only";

import { coreClient } from "@/lib/clients/core.client";
import type {
  PatchVendorAdminRequest,
  Vendor,
  VendorMembership,
} from "@/lib/clients/generated/core";
import { VendorMemberRole } from "@/lib/clients/generated/core";

export interface VendorAdminPanelData {
  vendor: VendorMembership;
}

function isAdminMembership(
  membership: VendorMembership,
): membership is VendorMembership & { role: typeof VendorMemberRole.ADMIN } {
  return membership.role === VendorMemberRole.ADMIN;
}

function buildVendorPatchBody(
  current: Vendor,
  updates: {
    name?: string;
    logos?: {
      light?: string | null;
      dark?: string | null;
    };
  },
): PatchVendorAdminRequest {
  const body: PatchVendorAdminRequest = {};

  if (updates.name !== undefined && updates.name !== current.name) {
    body.name = updates.name;
  }

  const logos: NonNullable<PatchVendorAdminRequest["logos"]> = {};
  if (
    updates.logos?.light !== undefined &&
    updates.logos.light !== current.logos.light
  ) {
    logos.light = updates.logos.light;
  }
  if (
    updates.logos?.dark !== undefined &&
    updates.logos.dark !== current.logos.dark
  ) {
    logos.dark = updates.logos.dark;
  }
  if (Object.keys(logos).length > 0) {
    body.logos = logos;
  }

  return body;
}

export const vendorService = (() => {
  async function listVendors(): Promise<Vendor[]> {
    const { data } = await coreClient.listVendors();
    return data;
  }

  async function listMyVendorMemberships(): Promise<VendorMembership[]> {
    const { data } = await coreClient.listMyVendorMemberships();
    return data ?? [];
  }

  async function listMyAdminVendorMemberships(): Promise<VendorMembership[]> {
    const memberships = await listMyVendorMemberships();
    return memberships.filter(isAdminMembership);
  }

  async function getVendorAdminPanelData(
    vendorId: string,
  ): Promise<VendorAdminPanelData | null> {
    const memberships = await listMyAdminVendorMemberships();
    const vendor = memberships.find((membership) => membership.id === vendorId);
    if (!vendor) {
      return null;
    }

    return { vendor };
  }

  async function patchVendorProfile(
    vendorId: string,
    current: Vendor,
    updates: {
      name?: string;
      logos?: {
        light?: string | null;
        dark?: string | null;
      };
    },
  ): Promise<Vendor> {
    const body = buildVendorPatchBody(current, updates);
    if (Object.keys(body).length === 0) {
      return current;
    }

    const { data } = await coreClient.patchVendor(vendorId, body);
    return data;
  }

  return {
    listVendors,
    listMyVendorMemberships,
    listMyAdminVendorMemberships,
    getVendorAdminPanelData,
    patchVendorProfile,
  };
})();

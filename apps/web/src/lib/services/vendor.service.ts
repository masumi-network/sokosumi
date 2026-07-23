import "server-only";

import { coreClient } from "@/lib/clients/core.client";
import type {
  Coworker,
  CoworkerAssignment,
  PatchVendorAdminRequest,
  Vendor,
  VendorMember,
  VendorMembership,
} from "@/lib/clients/generated/core";
import { VendorMemberRole } from "@/lib/clients/generated/core";
import { developerCoworkerService } from "@/lib/services/developer-coworker.service";

export interface VendorCoworkerAssignments {
  coworker: Coworker;
  assignments: CoworkerAssignment[];
}

export interface VendorAdminPanelData {
  vendor: VendorMembership;
  members: VendorMember[];
  developerMembers: VendorMember[];
  coworkerAssignments: VendorCoworkerAssignments[];
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

  async function listVendorMembers(vendorId: string): Promise<VendorMember[]> {
    const { data } = await coreClient.listVendorMembers(vendorId);
    return data ?? [];
  }

  async function listVendorDeveloperMembers(
    vendorId: string,
  ): Promise<VendorMember[]> {
    const members = await listVendorMembers(vendorId);
    return members.filter(
      (member) => member.role === VendorMemberRole.DEVELOPER,
    );
  }

  async function listVendorCoworkers(vendorId: string): Promise<Coworker[]> {
    const coworkers = await developerCoworkerService.listOwnedCoworkers();
    return coworkers.filter((coworker) => coworker.vendor.id === vendorId);
  }

  async function listCoworkerAssignments(
    vendorId: string,
    coworkerId: string,
  ): Promise<CoworkerAssignment[]> {
    const { data } = await coreClient.listCoworkerAssignments(
      vendorId,
      coworkerId,
    );
    return data ?? [];
  }

  async function getVendorAdminPanelData(
    vendorId: string,
  ): Promise<VendorAdminPanelData | null> {
    const memberships = await listMyAdminVendorMemberships();
    const vendor = memberships.find((membership) => membership.id === vendorId);
    if (!vendor) {
      return null;
    }

    const [members, coworkers] = await Promise.all([
      listVendorMembers(vendorId),
      listVendorCoworkers(vendorId),
    ]);

    const coworkerAssignments = await Promise.all(
      coworkers.map(async (coworker) => ({
        coworker,
        assignments: await listCoworkerAssignments(vendorId, coworker.id),
      })),
    );

    return {
      vendor,
      members,
      developerMembers: members.filter(
        (member) => member.role === VendorMemberRole.DEVELOPER,
      ),
      coworkerAssignments,
    };
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

  async function assignCoworkerDeveloper(
    vendorId: string,
    coworkerId: string,
    userId: string,
  ): Promise<CoworkerAssignment> {
    const { data } = await coreClient.assignCoworkerDeveloper(
      vendorId,
      coworkerId,
      userId,
    );
    return data;
  }

  async function unassignCoworkerDeveloper(
    vendorId: string,
    coworkerId: string,
    userId: string,
  ): Promise<void> {
    await coreClient.unassignCoworkerDeveloper(vendorId, coworkerId, userId);
  }

  return {
    listVendors,
    listMyVendorMemberships,
    listMyAdminVendorMemberships,
    listVendorMembers,
    listVendorDeveloperMembers,
    listVendorCoworkers,
    listCoworkerAssignments,
    getVendorAdminPanelData,
    patchVendorProfile,
    assignCoworkerDeveloper,
    unassignCoworkerDeveloper,
  };
})();

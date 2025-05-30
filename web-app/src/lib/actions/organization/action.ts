"use server";

import { revalidatePath } from "next/cache";
import slugify from "slugify";
import { v4 as uuidv4 } from "uuid";

import {
  createMember,
  createOrganization,
  deleteMember,
  getOrganizationMembers,
  isEmailAllowedByOrganization,
  listMembers,
  OrganizationWithRelations,
} from "@/lib/db";
import { Role } from "@/prisma/generated/client";

export async function createOrganizationFromName(name: string) {
  try {
    // make slug from name
    // slugify name and attach uuid
    const slug = `${slugify(name, {
      lower: true,
    })}-${uuidv4()}`;

    const organization = await createOrganization(name, slug);
    // Revalidate the register page to update the UI
    revalidatePath("/register");
    return { organization, success: true };
  } catch (error) {
    console.error("Error creating organization", error);
    return { organization: null, success: false };
  }
}

export async function createOrganizationMember(
  userId: string,
  userEmail: string,
  organization: OrganizationWithRelations,
) {
  try {
    // check user email's domain
    if (!isEmailAllowedByOrganization(userEmail, organization)) {
      return {
        success: false,
        code: "EMAIL_DOMAIN_NOT_ALLOWED_BY_ORGANIZATION",
      };
    }

    // check if organization has any members
    const members = await getOrganizationMembers(organization.id);

    // if there are no members, the create as ADMIN
    const role = members.length === 0 ? Role.ADMIN : Role.MEMBER;
    await createMember(userId, organization.id, role);
    return { success: true };
  } catch (error) {
    console.error("Error creating organization member", error);
    return { success: false };
  }
}

export async function leaveOrganization(organizationId: string) {
  try {
    const members = await listMembers();

    // if you have less than 2 members, you cannot leave
    if (members.length <= 1) {
      return { success: false, code: "MEMBER_COUNT_NOT_ALLOWED" };
    }

    // delete member
    await deleteMember(organizationId);

    return { success: true };
  } catch (error) {
    console.error("Error leaving organization", error);
    return { success: false };
  }
}

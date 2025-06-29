"use server";
//TODO: This needs to be restructured
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSession } from "@/lib/auth/utils";
import {
  getOrganizationById,
  getOrganizationsAllowedBySpecificEmailDomain,
  updateOrganization,
} from "@/lib/db/organization/repo";
import {
  MemberRole,
  OrganizationWithRelations,
} from "@/lib/db/organization/types";
import { getMyMemberInOrganization } from "@/lib/services/organization/service";
import { getEmailDomain } from "@/lib/utils";
import { Prisma } from "@/prisma/generated/client";

import { OrganizationActionErrorCode } from "./error";

const getAllowedOrganizationsSchema = z.object({
  email: z.string().min(1).max(250),
  organizationId: z.string().max(250).nullable(),
});
export async function getAllowedOrganizations(
  email: string,
  organizationId: string | null,
) {
  const validated = getAllowedOrganizationsSchema.safeParse({
    email,
    organizationId,
  });
  if (!validated.success) {
    return [];
  }
  if (organizationId) {
    const organization = await getOrganizationById(organizationId);
    if (!organization) {
      return [];
    }
    return [organization];
  }

  const emailDomain = getEmailDomain(email);
  if (!emailDomain) {
    return [];
  }
  const allowedOrganizations =
    await getOrganizationsAllowedBySpecificEmailDomain(emailDomain);
  return allowedOrganizations;
}
export async function getOrganizationWithRelationsById(
  id: string,
): Promise<OrganizationWithRelations | null> {
  return await getOrganizationById(id);
}

export async function updateOrganizationInformation(
  organizationId: string,
  data: Prisma.OrganizationUpdateInput,
): Promise<{ success: false; error: { code: string } } | { success: true }> {
  try {
    const session = await getSession();
    if (!session) {
      return {
        success: false,
        error: { code: OrganizationActionErrorCode.NOT_AUTHENTICATED },
      };
    }

    // check membership and role
    const member = await getMyMemberInOrganization(organizationId);
    if (!member || member.role !== MemberRole.ADMIN) {
      return {
        success: false,
        error: {
          code: OrganizationActionErrorCode.UNAUTHORIZED,
        },
      };
    }

    // update organization information
    const updatedOrganization = await updateOrganization(organizationId, data);

    // revalidate the organization page
    revalidatePath(`/app/organizations/${updatedOrganization.slug}`);
    return { success: true };
  } catch (error) {
    console.error("Error updating organization information", error);
    return {
      success: false,
      error: {
        code: OrganizationActionErrorCode.INTERNAL_SERVER_ERROR,
      },
    };
  }
}

export async function revalidateOrganizationsPath() {
  revalidatePath("/app/organizations");
}

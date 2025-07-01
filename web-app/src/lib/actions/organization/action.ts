"use server";

import { revalidatePath } from "next/cache";

import { ActionError, CommonErrorCode } from "@/lib/actions";
import { getSession } from "@/lib/auth/utils";
import { MemberRole } from "@/lib/db";
import {
  retrieveOrganizationsAllowedBySpecificEmailDomain,
  retrieveOrganizationWithRelationsById,
  updateOrganizationById,
} from "@/lib/db/repositories";
import {
  getAllowedOrganizationsSchema,
  updateOrganizationInformationFormSchema,
} from "@/lib/schemas";
import { getMyMemberInOrganization } from "@/lib/services";
import { Err, Ok, Result } from "@/lib/ts-res";
import { getEmailDomain } from "@/lib/utils/email";
import { Prisma } from "@/prisma/generated/client";

export async function updateOrganizationInformation(
  organizationId: string,
  data: Prisma.OrganizationUpdateInput,
): Promise<Result<void, ActionError>> {
  try {
    const session = await getSession();
    if (!session) {
      return Err({
        message: "Unauthenticated",
        code: CommonErrorCode.UNAUTHENTICATED,
      });
    }

    const parsedResult =
      updateOrganizationInformationFormSchema().safeParse(data);
    if (!parsedResult.success) {
      return Err({
        message: "Bad Input",
        code: CommonErrorCode.BAD_INPUT,
      });
    }

    // check membership and role
    const member = await getMyMemberInOrganization(organizationId);
    if (!member || member.role !== MemberRole.ADMIN) {
      return Err({
        message: "Unauthorized",
        code: CommonErrorCode.UNAUTHORIZED,
      });
    }

    // update organization information
    const updatedOrganization = await updateOrganizationById(organizationId, {
      name: parsedResult.data.name,
      metadata:
        parsedResult.data.metadata === "" ? null : parsedResult.data.metadata,
      requiredEmailDomains: parsedResult.data.requiredEmailDomains,
    });

    // revalidate the organization page
    revalidatePath(`/app/organizations/${updatedOrganization.slug}`);
    return Ok();
  } catch (error) {
    console.error("Error updating organization information", error);
    return Err({
      message: "Internal server error",
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
}

export async function getAllowedOrganizationsByEmailPartial(
  email: string,
  organizationId: string | null,
) {
  const validated = getAllowedOrganizationsSchema().safeParse({
    email,
    organizationId,
  });
  if (!validated.success) {
    return [];
  }
  if (organizationId) {
    const organization =
      await retrieveOrganizationWithRelationsById(organizationId);
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
    await retrieveOrganizationsAllowedBySpecificEmailDomain(emailDomain);
  return allowedOrganizations;
}

export async function revalidateOrganizationsPath() {
  revalidatePath("/app/organizations");
}

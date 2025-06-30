"use server";

import { revalidatePath } from "next/cache";

import {
  ActionError,
  CommonErrorCode,
  OrganizationErrorCode,
} from "@/lib/actions/types";
import { getSession } from "@/lib/auth/utils";
import { isEmailAllowedByOrganization, MemberRole } from "@/lib/db";
import {
  createMember,
  createOrganization,
  retrieveMembersByOrganizationId,
  updateOrganizationById,
} from "@/lib/db/repositories";
import {
  generateOrganizationSlugFromName,
  getMyMemberInOrganization,
} from "@/lib/services";
import { Err, Ok, Result } from "@/lib/ts-res";
import { Organization, Prisma } from "@/prisma/generated/client";

export async function createOrganizationFromName(
  name: string,
  requiredEmailDomains: string[],
): Promise<Result<{ organization: Organization }, ActionError>> {
  try {
    const slug = await generateOrganizationSlugFromName(name);

    const organization = await createOrganization(
      slug,
      name,
      requiredEmailDomains,
    );
    // Revalidate the register page to update the UI
    revalidatePath("/register");
    return Ok({ organization });
  } catch (error) {
    console.error("Error creating organization", error);
    return Err({
      message: "Internal server error",
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
}

// used when user sign up
// with organization
// and update all pending invitations
export async function createOrganizationMember(
  userId: string,
  userEmail: string,
  organization: Organization,
): Promise<Result<void, ActionError>> {
  try {
    // check user email's domain
    if (!isEmailAllowedByOrganization(userEmail, organization)) {
      return Err({
        message: "Email domain not allowed by organization",
        code: OrganizationErrorCode.EMAIL_DOMAIN_NOT_ALLOWED_BY_ORGANIZATION,
      });
    }

    // check if organization has any members
    const members = await retrieveMembersByOrganizationId(organization.id);

    // if there are no members, the create as ADMIN
    const role = members.length === 0 ? MemberRole.ADMIN : MemberRole.MEMBER;
    await createMember(userId, organization.id, role);
    return Ok();
  } catch (error) {
    console.error("Error creating organization member", error);
    return Err({
      message: "Internal server error",
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
}

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

    // check membership and role
    const member = await getMyMemberInOrganization(organizationId);
    if (!member || member.role !== MemberRole.ADMIN) {
      return Err({
        message: "Unauthorized",
        code: CommonErrorCode.UNAUTHORIZED,
      });
    }

    // update organization information
    const updatedOrganization = await updateOrganizationById(
      organizationId,
      data,
    );

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

export async function revalidateOrganizationsPath() {
  revalidatePath("/app/organizations");
}

"use server";

import { revalidatePath } from "next/cache";

import { ActionError, CommonErrorCode } from "@/lib/actions/types";
import { getSession } from "@/lib/auth/utils";
import { MemberRole } from "@/lib/db";
import { updateOrganizationById } from "@/lib/db/repositories";
import { getMyMemberInOrganization } from "@/lib/services";
import { Err, Ok, Result } from "@/lib/ts-res";
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

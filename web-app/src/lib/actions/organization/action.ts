"use server";

import { revalidatePath } from "next/cache";

import { ActionError, CommonErrorCode } from "@/lib/actions";
import { getSession } from "@/lib/auth/utils";
import { MemberRole } from "@/lib/db";
import {
  memberRepository,
  organizationRepository,
  prisma,
} from "@/lib/db/repositories";
import {
  organizationInformationFormSchema,
  OrganizationInformationFormSchemaType,
} from "@/lib/schemas";
import {
  generateOrganizationSlugFromName,
  getMyMemberInOrganization,
} from "@/lib/services";
import { Err, Ok, Result } from "@/lib/ts-res";
import { Organization } from "@/prisma/generated/client";

export async function createOrganization(
  data: OrganizationInformationFormSchemaType,
): Promise<Result<Organization, ActionError>> {
  try {
    const session = await getSession();
    if (!session) {
      return Err({
        message: "Unauthenticated",
        code: CommonErrorCode.UNAUTHENTICATED,
      });
    }
    const userId = session.user.id;

    const parsedResult = organizationInformationFormSchema().safeParse(data);
    if (!parsedResult.success) {
      return Err({
        message: "Bad Input",
        code: CommonErrorCode.BAD_INPUT,
      });
    }

    // generate slug from name
    const slug = await generateOrganizationSlugFromName(parsedResult.data.name);

    // create organization and admin atomically
    const { organization } = await prisma.$transaction(async (tx) => {
      // create organization
      const organization = await organizationRepository.createOrganization(
        slug,
        parsedResult.data.name,
        parsedResult.data.metadata ?? null,
        tx,
      );

      // create admin
      await memberRepository.createMember(
        userId,
        organization.id,
        MemberRole.ADMIN,
        tx,
      );

      return {
        organization,
      };
    });

    return Ok(organization);
  } catch (error) {
    console.error("Error creating organization", error);
    return Err({
      message: "Internal server error",
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
}

export async function updateOrganizationInformation(
  organizationId: string,
  data: OrganizationInformationFormSchemaType,
): Promise<Result<void, ActionError>> {
  try {
    const session = await getSession();
    if (!session) {
      return Err({
        message: "Unauthenticated",
        code: CommonErrorCode.UNAUTHENTICATED,
      });
    }

    const parsedResult = organizationInformationFormSchema().safeParse(data);
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
    await organizationRepository.updateOrganizationById(organizationId, {
      name: parsedResult.data.name,
      metadata:
        parsedResult.data.metadata === "" ? null : parsedResult.data.metadata,
    });
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
  revalidatePath("/organizations");
}

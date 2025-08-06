"use server";

import { headers } from "next/headers";

import {
  ActionError,
  CommonErrorCode,
  OrganizationErrorCode,
} from "@/lib/actions";
import { auth } from "@/lib/auth/auth";
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
import { organizationService, userService } from "@/lib/services";
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
    const slug = await organizationService.generateOrganizationSlugFromName(
      parsedResult.data.name,
    );

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
    const member = await userService.getMyMemberInOrganization(organizationId);
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

/**
 * Leave an organization.
 * If user is not a member of the organization, they cannot leave.
 * If user is the last admin of the organization, they cannot leave.
 * If user is the last person of the organization, they cannot leave.
 *
 * @param organizationId - The ID of the organization to check if the user can leave.
 * @returns A promise that resolves to a boolean indicating if the user can leave the organization.
 */
export async function leaveOrganization(
  organizationId: string,
): Promise<Result<void, ActionError>> {
  try {
    const session = await getSession();
    if (!session) {
      return Err({
        message: "Unauthenticated",
        code: CommonErrorCode.UNAUTHENTICATED,
      });
    }
    const userId = session.user.id;

    // check if the user is a member of the organization
    const myMemberInOrganization =
      await memberRepository.getMemberByUserIdAndOrganizationId(
        userId,
        organizationId,
      );
    if (!myMemberInOrganization) {
      return Err({
        message: "Unauthorized",
        code: CommonErrorCode.UNAUTHORIZED,
      });
    }

    // get members counts of the organization
    const peopleCountByRole =
      await memberRepository.getPerRoleCountByOrganizationId(organizationId);
    const totalCount = Object.values(peopleCountByRole).reduce(
      (acc, count) => acc + count,
      0,
    );

    // check if user is the last person of the organization
    if (totalCount <= 1) {
      return Err({
        message: "Last Person",
        code: OrganizationErrorCode.LAST_PERSON,
      });
    }

    // check if user is the last admin of the organization
    if (
      myMemberInOrganization.role === MemberRole.ADMIN &&
      peopleCountByRole[MemberRole.ADMIN] <= 1
    ) {
      return Err({
        message: "Last Admin",
        code: OrganizationErrorCode.LAST_ADMIN,
      });
    }

    // now delete the member
    await auth.api.leaveOrganization({
      headers: await headers(),
      body: {
        organizationId,
      },
    });

    return Ok();
  } catch (error) {
    console.error("Error leaving organization", error);
    return Err({
      message: "Internal server error",
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
}

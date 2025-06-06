"use server";

import { nanoid } from "nanoid";
import slugify from "slugify";

import { getSessionOrThrow } from "@/lib/auth/utils";
import {
  getMemberByUserIdAndOrganizationId,
  getMembersWithOrganizationByUserId,
  getMembersWithUser,
  getOrganizationBySlug,
  MemberWithOrganization,
} from "@/lib/db";
import { Member } from "@/prisma/generated/client";

export async function generateOrganizationSlugFromName(name: string) {
  const slugedName = slugify(name, { lower: true, strict: true });
  const existingOrganization = await getOrganizationBySlug(slugedName);
  if (!existingOrganization) {
    return slugedName;
  }

  const uniqueId = nanoid(6);
  return `${slugedName}-${uniqueId}`;
}

export async function listMyMembers(): Promise<MemberWithOrganization[]> {
  const session = await getSessionOrThrow();
  const userId = session.user.id;

  return await getMembersWithOrganizationByUserId(userId);
}

export async function getMyMemberInOrganization(
  organizationId: string,
): Promise<Member | null> {
  const session = await getSessionOrThrow();
  const userId = session.user.id;

  const member = await getMemberByUserIdAndOrganizationId(
    userId,
    organizationId,
  );

  return member;
}

export async function getOrganizationMembersWithUser(
  organizationId: string,
  includeMe = false,
  params: {
    page: number;
    limit: number;
  } = {
    page: 1,
    limit: 100,
  },
) {
  const session = await getSessionOrThrow();
  const userId = session.user.id;

  const members = await getMembersWithUser(
    {
      organizationId,
      ...(includeMe ? {} : { userId: { not: userId } }),
    },
    params,
  );

  return members;
}

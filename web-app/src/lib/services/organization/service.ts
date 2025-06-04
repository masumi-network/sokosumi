"use server";

import { nanoid } from "nanoid";
import slugify from "slugify";

import { getSessionOrThrow } from "@/lib/auth/utils";
import {
  filterMembers,
  getMemberByUserIdAndOrganizationId,
  getOrganizationBySlug,
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

export async function findMemberInOrganization(
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

export async function getOrganizationMembers(
  organizationId: string,
  includeMe = false,
  params: {
    page: number;
    limit: number;
  } = {
    page: 1,
    limit: 10,
  },
) {
  const session = await getSessionOrThrow();
  const userId = session.user.id;

  const members = await filterMembers(
    {
      organizationId,
      ...(includeMe ? {} : { userId: { not: userId } }),
    },
    params,
  );

  return members;
}

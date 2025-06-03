"use server";

import { nanoid } from "nanoid";
import slugify from "slugify";

import { getSessionOrThrow } from "@/lib/auth/utils";
import {
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

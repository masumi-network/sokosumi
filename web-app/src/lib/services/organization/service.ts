"use server";

import { nanoid } from "nanoid";
import slugify from "slugify";

import { getOrganizationBySlug } from "@/lib/db";

export async function generateOrganizationSlugFromName(name: string) {
  const slugedName = slugify(name, { lower: true, strict: true });
  const existingOrganization = await getOrganizationBySlug(slugedName);
  if (!existingOrganization) {
    return slugedName;
  }

  const uniqueId = nanoid(6);
  return `${slugedName}-${uniqueId}`;
}

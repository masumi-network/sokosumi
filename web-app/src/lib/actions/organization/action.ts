"use server";

import { revalidatePath } from "next/cache";
import slugify from "slugify";
import { v4 as uuidv4 } from "uuid";

import {
  connectUserToOrganization,
  createOrganization,
  isEmailAllowedByOrganization,
  OrganizationWithRelations,
} from "@/lib/db";

export async function createOrganizationFromName(name: string) {
  try {
    // make slug from name
    // slugify name and attach uuid
    const slug = `${slugify(name, {
      lower: true,
    })}-${uuidv4()}`;

    const organization = await createOrganization(name, slug);
    // Revalidate the register page to update the UI
    revalidatePath("/register");
    return { organization, success: true };
  } catch (error) {
    console.error("Error creating organization", error);
    return { organization: null, success: false };
  }
}

export async function createOrganizationMember(
  userId: string,
  userEmail: string,
  organization: OrganizationWithRelations,
) {
  try {
    // check user email's domain
    if (!isEmailAllowedByOrganization(userEmail, organization)) {
      return {
        success: false,
        code: "EMAIL_DOMAIN_NOT_ALLOWED_BY_ORGANIZATION",
      };
    }

    await connectUserToOrganization(userId, organization.id);
    return { success: true };
  } catch (error) {
    console.error("Error creating organization member", error);
    return { success: false };
  }
}

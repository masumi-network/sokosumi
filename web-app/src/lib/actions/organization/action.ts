"use server";

import { revalidatePath } from "next/cache";
import slugify from "slugify";
import { v4 as uuidv4 } from "uuid";

import { connectUserToOrganization, createOrganization } from "@/lib/db";

export async function createOrganizationFromName(name: string) {
  try {
    // make slug from name
    // slugify name and attach uuid
    const slug = `${slugify(name, {
      lower: true,
    })}-${uuidv4()}`;

    const organization = await createOrganization(name, slug);
    // Revalidate the app to update the UI
    revalidatePath("/app");
    return { organization, success: true };
  } catch (error) {
    console.error("Error creating organization", error);
    return { organization: null, success: false };
  }
}

export async function createOrganizationMember(
  userId: string,
  organizationId: string,
) {
  try {
    await connectUserToOrganization(userId, organizationId);
    return { success: true };
  } catch (error) {
    console.error("Error creating organization member", error);
    return { success: false };
  }
}

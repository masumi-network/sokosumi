"use server";

import { ActionError, CommonErrorCode } from "@/lib/actions";
import {
  organizationInformationFormSchema,
  OrganizationInformationFormSchemaType,
} from "@/lib/schemas";
import { organizationService } from "@/lib/services";
import { Err, Ok, Result } from "@/lib/ts-res";

export async function generateOrganizationSlug(
  data: OrganizationInformationFormSchemaType,
): Promise<Result<string, ActionError>> {
  try {
    const parsedResult = organizationInformationFormSchema().safeParse(data);
    if (!parsedResult.success) {
      return Err({
        code: CommonErrorCode.BAD_INPUT,
      });
    }

    const slug = await organizationService.generateOrganizationSlugFromName(
      parsedResult.data.name,
    );

    return Ok(slug);
  } catch (error) {
    console.error("Error generating organization slug", error);
    return Err({
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
}

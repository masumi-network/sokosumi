"use server";

import { z } from "zod";

import { ActionError, CommonErrorCode } from "@/lib/actions";
import { getAuthContext } from "@/lib/auth/utils";
import {
  memberRepository,
  organizationRepository,
} from "@/lib/db/repositories";
import { MemberRole } from "@/lib/db/types";
import {
  organizationInformationFormSchema,
  OrganizationInformationFormSchemaType,
} from "@/lib/schemas";
import { organizationService, stripeService } from "@/lib/services";
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

const updateInvoiceEmailSchema = z.object({
  organizationId: z.string(),
  invoiceEmail: z.string().email().nullable(),
});

export async function updateOrganizationInvoiceEmail(
  data: z.infer<typeof updateInvoiceEmailSchema>,
): Promise<Result<{ invoiceEmail: string | null }, ActionError>> {
  // Validate input
  const parsedResult = updateInvoiceEmailSchema.safeParse(data);
  if (!parsedResult.success) {
    return Err({
      code: CommonErrorCode.BAD_INPUT,
      message: parsedResult.error.errors[0]?.message,
    });
  }

  // Get current user session
  const context = await getAuthContext();
  if (!context) {
    return Err({
      code: CommonErrorCode.UNAUTHENTICATED,
      message: "Unauthenticated",
    });
  }

  const { organizationId, invoiceEmail } = parsedResult.data;

  // Check if user is an owner or admin of the organization
  const member = await memberRepository.getMemberByUserIdAndOrganizationId(
    context.userId,
    organizationId,
  );

  if (!member) {
    return Err({
      code: CommonErrorCode.UNAUTHORIZED,
      message: "You are not a member of this organization",
    });
  }

  // Only owners and admins can update invoice email
  if (member.role !== MemberRole.OWNER && member.role !== MemberRole.ADMIN) {
    return Err({
      code: CommonErrorCode.UNAUTHORIZED,
      message:
        "Only organization owners and admins can update the invoice email",
    });
  }

  // Update the invoice email in the database
  const updatedOrganization =
    await organizationRepository.updateOrganizationInvoiceEmail(
      organizationId,
      invoiceEmail,
    );

  // Sync with Stripe if the organization has a Stripe customer
  await stripeService.syncOrganizationInvoiceEmailWithStripe(
    organizationId,
    invoiceEmail,
  );

  return Ok({ invoiceEmail: updatedOrganization.invoiceEmail });
}

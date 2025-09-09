"use server";

import { z } from "zod";

import { ActionError, CommonErrorCode } from "@/lib/actions";
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
import {
  AuthenticatedRequest,
  withAuthContext,
} from "@/middleware/auth-middleware";

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
  invoiceEmail: z.email().nullable(),
});

interface UpdateOrganizationInvoiceEmailParameters
  extends AuthenticatedRequest {
  organizationId: string;
  invoiceEmail: string | null;
}

export const updateOrganizationInvoiceEmail = withAuthContext<
  UpdateOrganizationInvoiceEmailParameters,
  Result<{ invoiceEmail: string | null }, ActionError>
>(async (parameters) => {
  const { userId } = parameters.authContext;

  // Validate input
  const parsedResult = updateInvoiceEmailSchema.safeParse({
    organizationId: parameters.organizationId,
    invoiceEmail: parameters.invoiceEmail,
  });
  if (!parsedResult.success) {
    return Err({
      code: CommonErrorCode.BAD_INPUT,
      message: parsedResult.error.issues[0]?.message,
    });
  }
  const { organizationId, invoiceEmail } = parsedResult.data;

  // Check if user is an owner or admin of the organization
  const member = await memberRepository.getMemberByUserIdAndOrganizationId(
    userId,
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
});

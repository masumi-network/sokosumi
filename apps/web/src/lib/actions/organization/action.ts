"use server";

import { MemberRole } from "@sokosumi/database";
import {
  memberRepository,
  organizationRepository,
} from "@sokosumi/database/repositories";
import * as z from "zod";

import { ActionError, CommonErrorCode } from "@/lib/actions";
import { coreClient, toCoreApiActionError } from "@/lib/clients/core.client";
import prisma from "@/lib/db/prisma";
import {
  organizationInformationFormSchema,
  OrganizationInformationFormSchemaType,
} from "@/lib/schemas";
import {
  organizationService,
  preferredOrganizationService,
  stripeService,
} from "@/lib/services";
import { Err, Ok, Result } from "@/lib/ts-res";
import {
  AuthenticatedRequest,
  withSession,
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

export async function uploadOrganizationLogo(
  file: File,
): Promise<Result<string, ActionError>> {
  if (!(file instanceof File) || file.size <= 0) {
    return Err({
      code: CommonErrorCode.BAD_INPUT,
      message: "File is required",
    });
  }

  try {
    const response = await coreClient.uploadMyFile(file);
    const uploadedFileUrl = response.data.publicUrl;

    if (!uploadedFileUrl) {
      return Err({
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
        message: "Upload did not return a public URL",
      });
    }

    return Ok(uploadedFileUrl);
  } catch (error) {
    return Err(toCoreApiActionError(error));
  }
}

const updateInvoiceEmailSchema = z.object({
  organizationId: z.string(),
  invoiceEmail: z.email().nullable(),
});

interface UpdateOrganizationInvoiceEmailParameters extends AuthenticatedRequest {
  organizationId: string;
  invoiceEmail: string | null;
}

export const updateOrganizationInvoiceEmail = withSession<
  UpdateOrganizationInvoiceEmailParameters,
  Result<{ invoiceEmail: string | null }, ActionError>
>(async (parameters) => {
  const userId = parameters.session.user.id;

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
    prisma,
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
      prisma,
    );

  // Sync with Stripe if the organization has a Stripe customer
  await stripeService.syncOrganizationInvoiceEmailWithStripe(
    organizationId,
    invoiceEmail,
  );

  return Ok({ invoiceEmail: updatedOrganization.invoiceEmail });
});

const updatePreferredOrganizationSchema = z.object({
  organizationId: z.string().min(1).nullable(),
});

interface UpdatePreferredOrganizationParameters extends AuthenticatedRequest {
  organizationId: string | null;
}

export const updatePreferredOrganization = withSession<
  UpdatePreferredOrganizationParameters,
  Result<{ organizationId: string | null }, ActionError>
>(async ({ organizationId, session }) => {
  const parsedResult = updatePreferredOrganizationSchema.safeParse({
    organizationId,
  });

  if (!parsedResult.success) {
    return Err({
      code: CommonErrorCode.BAD_INPUT,
      message: parsedResult.error.issues[0]?.message,
    });
  }

  const result =
    await preferredOrganizationService.persistPreferredOrganizationId(
      session.user.id,
      parsedResult.data.organizationId,
    );

  if (!result.ok) {
    return Err({
      code: CommonErrorCode.UNAUTHORIZED,
      message: "You are not a member of this organization",
    });
  }

  return Ok({
    organizationId: result.organizationId,
  });
});

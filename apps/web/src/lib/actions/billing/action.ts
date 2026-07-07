"use server";

import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import * as z from "zod";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type { StripeCustomerBillingDetails } from "@/lib/clients/generated/core";
import { Err, Ok, type Result } from "@/lib/ts-res";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const billingAddressSchema = z.object({
  line1: z.string().min(1),
  line2: z.string().nullable().optional(),
  city: z.string().min(1),
  state: z.string().nullable().optional(),
  postalCode: z.string().min(1),
  country: z.string().length(2),
});

const updateBillingDetailsSchema = z.object({
  address: billingAddressSchema,
  taxIdValue: z.string().nullable().optional(),
});

const updateOrganizationBillingDetailsSchema =
  updateBillingDetailsSchema.extend({
    organizationId: z.string().min(1),
  });

interface UpdateMyBillingDetailsParameters extends AuthenticatedRequest {
  address: z.infer<typeof billingAddressSchema>;
  taxIdValue?: string | null;
}

interface UpdateOrganizationBillingDetailsParameters
  extends AuthenticatedRequest {
  organizationId: string;
  address: z.infer<typeof billingAddressSchema>;
  taxIdValue?: string | null;
}

function mapBillingDetailsWritePayload(
  data: z.infer<typeof updateBillingDetailsSchema>,
) {
  const trimmedTaxId = data.taxIdValue?.trim() ?? "";

  return {
    address: {
      line1: data.address.line1,
      line2: data.address.line2 ?? null,
      city: data.address.city,
      state: data.address.state ?? null,
      postalCode: data.address.postalCode,
      country: data.address.country,
    },
    taxId: trimmedTaxId ? { value: trimmedTaxId } : null,
  };
}

function mapBillingDetailsUpdateError(
  error: unknown,
): Result<StripeCustomerBillingDetails, ActionError> {
  if (error instanceof CoreApiRequestError) {
    if (
      error.kind === CORE_API_ERROR_KINDS.ORGANIZATION_NOT_FOUND ||
      error.kind === CORE_API_ERROR_KINDS.ORGANIZATION_MEMBERSHIP_REQUIRED ||
      error.kind === CORE_API_ERROR_KINDS.ORGANIZATION_ROLE_FORBIDDEN ||
      error.status === 403 ||
      error.status === 404
    ) {
      return Err({
        code: CommonErrorCode.UNAUTHORIZED,
        message: error.message,
      });
    }

    if (error.status === 422) {
      return Err({
        code: CommonErrorCode.BAD_INPUT,
        message: error.message,
      });
    }
  }

  throw error;
}

export const updateMyBillingDetails = withSession<
  UpdateMyBillingDetailsParameters,
  Result<StripeCustomerBillingDetails, ActionError>
>(async (parameters) => {
  const parsedResult = updateBillingDetailsSchema.safeParse({
    address: parameters.address,
    taxIdValue: parameters.taxIdValue,
  });
  if (!parsedResult.success) {
    return Err({
      code: CommonErrorCode.BAD_INPUT,
      message: parsedResult.error.issues[0]?.message,
    });
  }

  try {
    const { data } = await coreClient.updateMyBillingDetails(
      mapBillingDetailsWritePayload(parsedResult.data),
    );
    return Ok(data);
  } catch (error) {
    return mapBillingDetailsUpdateError(error);
  }
});

export const updateOrganizationBillingDetails = withSession<
  UpdateOrganizationBillingDetailsParameters,
  Result<StripeCustomerBillingDetails, ActionError>
>(async (parameters) => {
  const parsedResult = updateOrganizationBillingDetailsSchema.safeParse({
    organizationId: parameters.organizationId,
    address: parameters.address,
    taxIdValue: parameters.taxIdValue,
  });
  if (!parsedResult.success) {
    return Err({
      code: CommonErrorCode.BAD_INPUT,
      message: parsedResult.error.issues[0]?.message,
    });
  }

  const { organizationId, ...billingDetails } = parsedResult.data;

  try {
    const { data } = await coreClient.updateOrganizationBillingDetails(
      organizationId,
      mapBillingDetailsWritePayload(billingDetails),
    );
    return Ok(data);
  } catch (error) {
    return mapBillingDetailsUpdateError(error);
  }
});

"use server";

import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import type {
  ActivateEnterpriseContractResponse,
  CreateEnterpriseContractRequest,
  EnterpriseContract,
  EnterpriseContractPreview,
  EnterpriseContractStatus,
  PatchEnterpriseContractRequest,
} from "@/lib/clients/generated/core/types.gen";
import {
  type EnterpriseContractActivationBlockedError,
  enterpriseContractAdminService,
  parseEnterpriseContractActivationBlockedError,
} from "@/lib/services/enterprise-contract-admin.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

export type EnterpriseContractActionError =
  | ActionError
  | EnterpriseContractActivationBlockedError;

function revalidateEnterpriseContractRoutes(contractId?: string) {
  revalidatePath("/admin/enterprise-contracts");
  if (contractId) {
    revalidatePath(`/admin/enterprise-contracts/${contractId}`);
    revalidatePath(`/admin/enterprise-contracts/${contractId}/edit`);
  }
}

function mapCoreError(error: unknown): ActionError {
  if (isAdminAccessRequiredError(error)) {
    return {
      code: CommonErrorCode.UNAUTHORIZED,
      message: error.message,
    };
  }

  return toCoreApiActionError(error);
}

interface ListEnterpriseContractsParameters extends AuthenticatedRequest {
  organizationSlug?: string;
  status?: EnterpriseContractStatus;
}

export const listEnterpriseContractsAction = withSession<
  ListEnterpriseContractsParameters,
  ActionResultDto<EnterpriseContract[], ActionError>
>(async ({ session, organizationSlug, status }) => {
  try {
    assertAdminSession(session);
    const contracts = await enterpriseContractAdminService.listContracts({
      organizationSlug: organizationSlug?.trim() || undefined,
      status,
    });
    return toActionResult(ok(contracts));
  } catch (error) {
    return toActionResult(err(mapCoreError(error)));
  }
});

interface CreateEnterpriseContractParameters extends AuthenticatedRequest {
  body: CreateEnterpriseContractRequest;
}

export const createEnterpriseContractAction = withSession<
  CreateEnterpriseContractParameters,
  ActionResultDto<EnterpriseContract, ActionError>
>(async ({ session, body }) => {
  try {
    assertAdminSession(session);
    const contract = await enterpriseContractAdminService.createContract(body);
    revalidateEnterpriseContractRoutes(contract.id);
    return toActionResult(ok(contract));
  } catch (error) {
    return toActionResult(err(mapCoreError(error)));
  }
});

interface GetEnterpriseContractParameters extends AuthenticatedRequest {
  id: string;
}

export const getEnterpriseContractAction = withSession<
  GetEnterpriseContractParameters,
  ActionResultDto<EnterpriseContract, ActionError>
>(async ({ session, id }) => {
  try {
    assertAdminSession(session);
    const contract = await enterpriseContractAdminService.getContract(id);
    return toActionResult(ok(contract));
  } catch (error) {
    return toActionResult(err(mapCoreError(error)));
  }
});

interface UpdateEnterpriseContractParameters extends AuthenticatedRequest {
  id: string;
  body: PatchEnterpriseContractRequest;
}

export const updateEnterpriseContractAction = withSession<
  UpdateEnterpriseContractParameters,
  ActionResultDto<EnterpriseContract, ActionError>
>(async ({ session, id, body }) => {
  try {
    assertAdminSession(session);
    const contract = await enterpriseContractAdminService.updateContract(
      id,
      body,
    );
    revalidateEnterpriseContractRoutes(id);
    return toActionResult(ok(contract));
  } catch (error) {
    return toActionResult(err(mapCoreError(error)));
  }
});

interface PreviewEnterpriseContractPeriodsParameters
  extends AuthenticatedRequest {
  id: string;
  activatedAt: string;
}

export const previewEnterpriseContractPeriodsAction = withSession<
  PreviewEnterpriseContractPeriodsParameters,
  ActionResultDto<EnterpriseContractPreview, ActionError>
>(async ({ session, id, activatedAt }) => {
  try {
    assertAdminSession(session);

    const parsedActivatedAt = new Date(activatedAt);
    if (Number.isNaN(parsedActivatedAt.getTime())) {
      return toActionResult(
        err({
          code: CommonErrorCode.BAD_INPUT,
          message: "activatedAt must be a valid ISO datetime",
        }),
      );
    }

    const preview = await enterpriseContractAdminService.previewPeriods(
      id,
      parsedActivatedAt,
    );
    return toActionResult(ok(preview));
  } catch (error) {
    return toActionResult(err(mapCoreError(error)));
  }
});

interface ActivateEnterpriseContractParameters extends AuthenticatedRequest {
  id: string;
  paymentReference?: string;
}

export const activateEnterpriseContractAction = withSession<
  ActivateEnterpriseContractParameters,
  ActionResultDto<
    ActivateEnterpriseContractResponse,
    EnterpriseContractActionError
  >
>(async ({ session, id, paymentReference }) => {
  try {
    assertAdminSession(session);
    const result = await enterpriseContractAdminService.activateContract(
      id,
      paymentReference?.trim()
        ? { paymentReference: paymentReference.trim() }
        : undefined,
    );
    revalidateEnterpriseContractRoutes(id);
    return toActionResult(ok(result));
  } catch (error) {
    const blocked = parseEnterpriseContractActivationBlockedError(error);
    if (blocked) {
      return toActionResult(err(blocked));
    }
    return toActionResult(err(mapCoreError(error)));
  }
});

interface CancelEnterpriseContractParameters extends AuthenticatedRequest {
  id: string;
}

export const cancelEnterpriseContractAction = withSession<
  CancelEnterpriseContractParameters,
  ActionResultDto<EnterpriseContract, ActionError>
>(async ({ session, id }) => {
  try {
    assertAdminSession(session);
    const contract = await enterpriseContractAdminService.cancelContract(id);
    revalidateEnterpriseContractRoutes(id);
    return toActionResult(ok(contract));
  } catch (error) {
    return toActionResult(err(mapCoreError(error)));
  }
});

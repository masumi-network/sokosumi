"use server";

import { err, ok } from "neverthrow";
import * as z from "zod";

import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import { coworkerAccessService } from "@/lib/services/coworker-access.service";
import { vendorGrantService } from "@/lib/services/vendor-grant.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

type WorkspaceApprovalScope = "personal" | "organization";
type WorkspaceApprovalMutation = "approve" | "deny" | "revoke";
type WorkspaceApprovalIdKey = "grantId" | "accessId" | "vendorId";
type WorkspaceApprovalResultKey = "grantId" | "accessId";

interface WorkspaceApprovalActionConfig<
  TIdKey extends WorkspaceApprovalIdKey,
  TResultKey extends WorkspaceApprovalResultKey,
> {
  idKey: TIdKey;
  resultKey: TResultKey;
  label: string;
  runPersonal: (id: string) => Promise<{ id: string }>;
  runOrganization: (
    organizationId: string,
    id: string,
  ) => Promise<{ id: string }>;
}

interface WorkspaceApprovalKind<
  TIdKey extends WorkspaceApprovalIdKey,
  TResultKey extends WorkspaceApprovalResultKey,
> {
  idKey: TIdKey;
  resultKey: TResultKey;
  noun: string;
  personal: Record<
    WorkspaceApprovalMutation,
    (id: string) => Promise<{ id: string }>
  >;
  organization: Record<
    WorkspaceApprovalMutation,
    (organizationId: string, id: string) => Promise<{ id: string }>
  >;
}

type PersonalApprovalParams<TIdKey extends string> = AuthenticatedRequest &
  Record<TIdKey, string>;

type OrganizationApprovalParams<TIdKey extends string> = AuthenticatedRequest &
  Record<TIdKey, string> & {
    organizationId: string;
  };

type WorkspaceApprovalActionResult<TResultKey extends string> = ActionResultDto<
  Record<TResultKey, string>,
  ActionError
>;

const VENDOR_GRANT_KIND: WorkspaceApprovalKind<"grantId", "grantId"> = {
  idKey: "grantId",
  resultKey: "grantId",
  noun: "vendor grant",
  personal: {
    approve: vendorGrantService.approveMyVendorGrant,
    deny: vendorGrantService.denyMyVendorGrant,
    revoke: vendorGrantService.revokeMyVendorGrant,
  },
  organization: {
    approve: vendorGrantService.approveVendorGrant,
    deny: vendorGrantService.denyVendorGrant,
    revoke: vendorGrantService.revokeVendorGrant,
  },
};

const COWORKER_ACCESS_KIND: WorkspaceApprovalKind<"accessId", "accessId"> = {
  idKey: "accessId",
  resultKey: "accessId",
  noun: "coworker access",
  personal: {
    approve: (id) => coworkerAccessService.approve(id, { type: "personal" }),
    deny: (id) => coworkerAccessService.deny(id, { type: "personal" }),
    revoke: (id) => coworkerAccessService.revoke(id, { type: "personal" }),
  },
  organization: {
    approve: (organizationId, id) =>
      coworkerAccessService.approve(id, {
        type: "organization",
        organizationId,
      }),
    deny: (organizationId, id) =>
      coworkerAccessService.deny(id, {
        type: "organization",
        organizationId,
      }),
    revoke: (organizationId, id) =>
      coworkerAccessService.revoke(id, {
        type: "organization",
        organizationId,
      }),
  },
};

function resultPayload<TResultKey extends string>(
  resultKey: TResultKey,
  id: string,
): Record<TResultKey, string> {
  return { [resultKey]: id } as Record<TResultKey, string>;
}

function workspaceApprovalAction<
  TIdKey extends WorkspaceApprovalIdKey,
  TResultKey extends WorkspaceApprovalResultKey,
>(
  scope: "personal",
  config: WorkspaceApprovalActionConfig<TIdKey, TResultKey>,
): (
  params: PersonalApprovalParams<TIdKey>,
) => Promise<WorkspaceApprovalActionResult<TResultKey>>;
function workspaceApprovalAction<
  TIdKey extends WorkspaceApprovalIdKey,
  TResultKey extends WorkspaceApprovalResultKey,
>(
  scope: "organization",
  config: WorkspaceApprovalActionConfig<TIdKey, TResultKey>,
): (
  params: OrganizationApprovalParams<TIdKey>,
) => Promise<WorkspaceApprovalActionResult<TResultKey>>;
function workspaceApprovalAction<
  TIdKey extends WorkspaceApprovalIdKey,
  TResultKey extends WorkspaceApprovalResultKey,
>(
  scope: WorkspaceApprovalScope,
  config: WorkspaceApprovalActionConfig<TIdKey, TResultKey>,
) {
  const { idKey, resultKey, label, runPersonal, runOrganization } = config;

  if (scope === "personal") {
    return withSession<
      PersonalApprovalParams<TIdKey>,
      WorkspaceApprovalActionResult<TResultKey>
    >(async (params) => {
      const parsed = z.string().uuid().safeParse(params[idKey]);
      if (!parsed.success) {
        return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
      }

      try {
        const row = await runPersonal(parsed.data);
        return toActionResult(ok(resultPayload(resultKey, row.id)));
      } catch (error) {
        console.error(`Failed to ${label}`, error);
        return toActionResult(err(toCoreApiActionError(error)));
      }
    });
  }

  return withSession<
    OrganizationApprovalParams<TIdKey>,
    WorkspaceApprovalActionResult<TResultKey>
  >(async (params) => {
    const parsed = z
      .object({
        organizationId: z.string().min(1),
        id: z.string().uuid(),
      })
      .safeParse({
        organizationId: params.organizationId,
        id: params[idKey],
      });
    if (!parsed.success) {
      return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
    }

    try {
      const row = await runOrganization(
        parsed.data.organizationId,
        parsed.data.id,
      );
      return toActionResult(ok(resultPayload(resultKey, row.id)));
    } catch (error) {
      console.error(`Failed to ${label}`, error);
      return toActionResult(err(toCoreApiActionError(error)));
    }
  });
}

function bindWorkspaceApprovalAction<
  TIdKey extends WorkspaceApprovalIdKey,
  TResultKey extends WorkspaceApprovalResultKey,
>(
  kind: WorkspaceApprovalKind<TIdKey, TResultKey>,
  scope: "personal",
  method: WorkspaceApprovalMutation,
): (
  params: PersonalApprovalParams<TIdKey>,
) => Promise<WorkspaceApprovalActionResult<TResultKey>>;
function bindWorkspaceApprovalAction<
  TIdKey extends WorkspaceApprovalIdKey,
  TResultKey extends WorkspaceApprovalResultKey,
>(
  kind: WorkspaceApprovalKind<TIdKey, TResultKey>,
  scope: "organization",
  method: WorkspaceApprovalMutation,
): (
  params: OrganizationApprovalParams<TIdKey>,
) => Promise<WorkspaceApprovalActionResult<TResultKey>>;
function bindWorkspaceApprovalAction<
  TIdKey extends WorkspaceApprovalIdKey,
  TResultKey extends WorkspaceApprovalResultKey,
>(
  kind: WorkspaceApprovalKind<TIdKey, TResultKey>,
  scope: WorkspaceApprovalScope,
  method: WorkspaceApprovalMutation,
) {
  const config: WorkspaceApprovalActionConfig<TIdKey, TResultKey> = {
    idKey: kind.idKey,
    resultKey: kind.resultKey,
    label: `${method} ${scope} ${kind.noun}`,
    runPersonal: kind.personal[method],
    runOrganization: kind.organization[method],
  };

  if (scope === "personal") {
    return workspaceApprovalAction("personal", config);
  }

  return workspaceApprovalAction("organization", config);
}

export const approveMyVendorGrant = bindWorkspaceApprovalAction(
  VENDOR_GRANT_KIND,
  "personal",
  "approve",
);
export const denyMyVendorGrant = bindWorkspaceApprovalAction(
  VENDOR_GRANT_KIND,
  "personal",
  "deny",
);
export const revokeMyVendorGrant = bindWorkspaceApprovalAction(
  VENDOR_GRANT_KIND,
  "personal",
  "revoke",
);
export const createMyVendorGrant = workspaceApprovalAction("personal", {
  idKey: "vendorId",
  resultKey: "grantId",
  label: "create personal vendor grant",
  runPersonal: vendorGrantService.createMyVendorGrant,
  runOrganization: vendorGrantService.createVendorGrant,
});

export const approveOrganizationVendorGrant = bindWorkspaceApprovalAction(
  VENDOR_GRANT_KIND,
  "organization",
  "approve",
);
export const denyOrganizationVendorGrant = bindWorkspaceApprovalAction(
  VENDOR_GRANT_KIND,
  "organization",
  "deny",
);
export const revokeOrganizationVendorGrant = bindWorkspaceApprovalAction(
  VENDOR_GRANT_KIND,
  "organization",
  "revoke",
);
export const createOrganizationVendorGrant = workspaceApprovalAction(
  "organization",
  {
    idKey: "vendorId",
    resultKey: "grantId",
    label: "create organization vendor grant",
    runPersonal: vendorGrantService.createMyVendorGrant,
    runOrganization: vendorGrantService.createVendorGrant,
  },
);

export const approveMyCoworkerAccess = bindWorkspaceApprovalAction(
  COWORKER_ACCESS_KIND,
  "personal",
  "approve",
);
export const denyMyCoworkerAccess = bindWorkspaceApprovalAction(
  COWORKER_ACCESS_KIND,
  "personal",
  "deny",
);
export const revokeMyCoworkerAccess = bindWorkspaceApprovalAction(
  COWORKER_ACCESS_KIND,
  "personal",
  "revoke",
);

export const approveOrganizationCoworkerAccess = bindWorkspaceApprovalAction(
  COWORKER_ACCESS_KIND,
  "organization",
  "approve",
);
export const denyOrganizationCoworkerAccess = bindWorkspaceApprovalAction(
  COWORKER_ACCESS_KIND,
  "organization",
  "deny",
);
export const revokeOrganizationCoworkerAccess = bindWorkspaceApprovalAction(
  COWORKER_ACCESS_KIND,
  "organization",
  "revoke",
);

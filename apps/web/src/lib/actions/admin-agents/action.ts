"use server";

import { err, ok } from "neverthrow";
import { updateTag } from "next/cache";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import {
  AGENTS_CACHE_TAG,
  CATEGORIES_CACHE_TAG,
} from "@/lib/agents/core-loaders";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import type { PatchAdminAgentMetadataOverrideBody } from "@/lib/clients/generated/core";
import {
  type AdminAgentListPage,
  adminAgentService,
  type ListAdminAgentsParams,
} from "@/lib/services/admin-agent.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

function mapError(error: unknown): ActionError {
  if (isAdminAccessRequiredError(error)) {
    return {
      code: CommonErrorCode.UNAUTHORIZED,
      message: error.message,
    };
  }

  return {
    code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    message:
      error instanceof Error ? error.message : "Admin agent action failed",
  };
}

interface ListAdminAgentsRequest
  extends AuthenticatedRequest,
    ListAdminAgentsParams {}

export const listAdminAgentsAction = withSession<
  ListAdminAgentsRequest,
  ActionResultDto<AdminAgentListPage, ActionError>
>(async ({ session, q, cursor, limit, status, sortBy, sortOrder }) => {
  try {
    assertAdminSession(session);
    return toActionResult(
      ok(
        await adminAgentService.listAgents({
          q,
          cursor,
          limit,
          status,
          sortBy,
          sortOrder,
        }),
      ),
    );
  } catch (error) {
    return toActionResult(err(mapError(error)));
  }
});

interface PatchAdminAgentMetadataOverrideRequest extends AuthenticatedRequest {
  agentId: string;
  body: PatchAdminAgentMetadataOverrideBody;
}

export const patchAdminAgentMetadataOverrideAction = withSession<
  PatchAdminAgentMetadataOverrideRequest,
  ActionResultDto<
    Awaited<ReturnType<typeof adminAgentService.patchMetadataOverride>>,
    ActionError
  >
>(async ({ session, agentId, body }) => {
  try {
    assertAdminSession(session);
    const detail = await adminAgentService.patchMetadataOverride(agentId, body);
    updateTag(AGENTS_CACHE_TAG);
    updateTag(CATEGORIES_CACHE_TAG);
    return toActionResult(ok(detail));
  } catch (error) {
    return toActionResult(err(mapError(error)));
  }
});

interface DeleteAdminAgentMetadataOverrideRequest extends AuthenticatedRequest {
  agentId: string;
}

export const deleteAdminAgentMetadataOverrideAction = withSession<
  DeleteAdminAgentMetadataOverrideRequest,
  ActionResultDto<
    Awaited<ReturnType<typeof adminAgentService.deleteMetadataOverride>>,
    ActionError
  >
>(async ({ session, agentId }) => {
  try {
    assertAdminSession(session);
    const detail = await adminAgentService.deleteMetadataOverride(agentId);
    updateTag(AGENTS_CACHE_TAG);
    updateTag(CATEGORIES_CACHE_TAG);
    return toActionResult(ok(detail));
  } catch (error) {
    return toActionResult(err(mapError(error)));
  }
});

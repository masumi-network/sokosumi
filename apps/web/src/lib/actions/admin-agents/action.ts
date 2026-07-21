"use server";

import { updateTag } from "next/cache";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { AGENTS_CACHE_TAG } from "@/lib/agents/core-loaders";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import type { PatchAdminAgentMetadataOverrideBody } from "@/lib/clients/generated/core";
import {
  type AdminAgentListPage,
  adminAgentService,
  type ListAdminAgentsParams,
} from "@/lib/services/admin-agent.service";
import { Err, Ok, type Result } from "@/lib/ts-res";
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
  Result<AdminAgentListPage, ActionError>
>(async ({ session, q, cursor, limit, status }) => {
  try {
    assertAdminSession(session);
    return Ok(await adminAgentService.listAgents({ q, cursor, limit, status }));
  } catch (error) {
    return Err(mapError(error));
  }
});

interface PatchAdminAgentMetadataOverrideRequest extends AuthenticatedRequest {
  agentId: string;
  body: PatchAdminAgentMetadataOverrideBody;
}

export const patchAdminAgentMetadataOverrideAction = withSession<
  PatchAdminAgentMetadataOverrideRequest,
  Result<
    Awaited<ReturnType<typeof adminAgentService.patchMetadataOverride>>,
    ActionError
  >
>(async ({ session, agentId, body }) => {
  try {
    assertAdminSession(session);
    const detail = await adminAgentService.patchMetadataOverride(agentId, body);
    updateTag(AGENTS_CACHE_TAG);
    return Ok(detail);
  } catch (error) {
    return Err(mapError(error));
  }
});

interface DeleteAdminAgentMetadataOverrideRequest extends AuthenticatedRequest {
  agentId: string;
}

export const deleteAdminAgentMetadataOverrideAction = withSession<
  DeleteAdminAgentMetadataOverrideRequest,
  Result<
    Awaited<ReturnType<typeof adminAgentService.deleteMetadataOverride>>,
    ActionError
  >
>(async ({ session, agentId }) => {
  try {
    assertAdminSession(session);
    const detail = await adminAgentService.deleteMetadataOverride(agentId);
    updateTag(AGENTS_CACHE_TAG);
    return Ok(detail);
  } catch (error) {
    return Err(mapError(error));
  }
});

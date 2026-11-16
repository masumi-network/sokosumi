"use server";

import type {
  ConnectSeoConnectionResponse,
  SeoConnectionStatus,
} from "@sokosumi/core-client";
import { err, ok } from "neverthrow";
import { z } from "zod";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import {
  CoreApiRequestError,
  toCoreApiActionError,
} from "@/lib/clients/core.client";
import { seoConnectionService } from "@/lib/services/seo-connection.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const providerSchema = z.enum(["ga4", "search_console"]);
interface ProviderRequest extends AuthenticatedRequest {
  provider: unknown;
  viewerId: unknown;
  organizationId: unknown;
}
function viewerChanged(
  params: ProviderRequest & {
    session: NonNullable<AuthenticatedRequest["session"]>;
  },
) {
  return (
    params.viewerId !== params.session.user.id ||
    params.organizationId !==
      (params.session.session.activeOrganizationId ?? null)
  );
}
const changedViewer = {
  code: CommonErrorCode.UNAUTHORIZED,
  status: 409,
  kind: "seo_viewer_changed",
};
function connectionActionError(error: unknown): ActionError {
  return {
    ...toCoreApiActionError(error),
    ...(error instanceof CoreApiRequestError ? { status: error.status } : {}),
  };
}
export const connectSeoStatisticsAction = withSession<
  ProviderRequest & { callbackUrl: unknown },
  ActionResultDto<ConnectSeoConnectionResponse, ActionError>
>(async (params) => {
  if (viewerChanged(params)) return toActionResult(err(changedViewer));
  const { provider, callbackUrl } = params;
  const parsed = providerSchema.safeParse(provider);
  const callback = z.url().safeParse(callbackUrl);
  if (!parsed.success || !callback.success)
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  try {
    return toActionResult(
      ok(await seoConnectionService.connect(parsed.data, callback.data)),
    );
  } catch (error) {
    return toActionResult(err(connectionActionError(error)));
  }
});
export const finalizeSeoStatisticsAction = withSession<
  ProviderRequest & { connectionId?: unknown; sessionUri?: unknown },
  ActionResultDto<SeoConnectionStatus, ActionError>
>(async (params) => {
  if (viewerChanged(params)) return toActionResult(err(changedViewer));
  const { provider, connectionId, sessionUri } = params;
  const parsed = providerSchema.safeParse(provider);
  const input = z
    .object({
      connectionId: z.string().min(1).max(200).optional(),
      sessionUri: z.string().min(1).max(8_192).optional(),
    })
    .refine((value) => Boolean(value.connectionId || value.sessionUri))
    .safeParse({ connectionId, sessionUri });
  if (!parsed.success || !input.success)
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  try {
    return toActionResult(
      ok(
        await seoConnectionService.finalize(
          parsed.data,
          input.data.connectionId,
          input.data.sessionUri,
        ),
      ),
    );
  } catch (error) {
    return toActionResult(err(connectionActionError(error)));
  }
});
export const disconnectSeoStatisticsAction = withSession<
  ProviderRequest,
  ActionResultDto<{ disconnected: true }, ActionError>
>(async (params) => {
  if (viewerChanged(params)) return toActionResult(err(changedViewer));
  const { provider } = params;
  const parsed = providerSchema.safeParse(provider);
  if (!parsed.success)
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  try {
    return toActionResult(
      ok(await seoConnectionService.disconnect(parsed.data)),
    );
  } catch (error) {
    return toActionResult(err(connectionActionError(error)));
  }
});

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
import { toCoreApiActionError } from "@/lib/clients/core.client";
import { seoConnectionService } from "@/lib/services/seo-connection.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const providerSchema = z.enum(["ga4", "search_console"]);
interface ProviderRequest extends AuthenticatedRequest {
  provider: unknown;
}
export const connectSeoStatisticsAction = withSession<
  ProviderRequest & { callbackUrl: unknown },
  ActionResultDto<ConnectSeoConnectionResponse, ActionError>
>(async ({ provider, callbackUrl }) => {
  const parsed = providerSchema.safeParse(provider);
  const callback = z.url().safeParse(callbackUrl);
  if (!parsed.success || !callback.success)
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  try {
    return toActionResult(
      ok(await seoConnectionService.connect(parsed.data, callback.data)),
    );
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});
export const finalizeSeoStatisticsAction = withSession<
  ProviderRequest & { connectionId: unknown },
  ActionResultDto<SeoConnectionStatus, ActionError>
>(async ({ provider, connectionId }) => {
  const parsed = providerSchema.safeParse(provider);
  const id = z.string().min(1).max(200).safeParse(connectionId);
  if (!parsed.success || !id.success)
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  try {
    return toActionResult(
      ok(await seoConnectionService.finalize(parsed.data, id.data)),
    );
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});
export const disconnectSeoStatisticsAction = withSession<
  ProviderRequest,
  ActionResultDto<{ disconnected: true }, ActionError>
>(async ({ provider }) => {
  const parsed = providerSchema.safeParse(provider);
  if (!parsed.success)
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  try {
    return toActionResult(
      ok(await seoConnectionService.disconnect(parsed.data)),
    );
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

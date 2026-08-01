"use server";

import * as z from "zod";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import { Err, Ok, type Result } from "@/lib/ts-res";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const resolveSiteIconSchema = z.object({
  url: z.url(),
  organizationId: z.string().trim().min(1),
});

interface ResolveOrganizationSiteIconParameters extends AuthenticatedRequest {
  url: string;
  organizationId: string;
}

/**
 * Resolves the highest-quality icon for a website URL and returns its
 * uploaded blob URL (or null when no usable icon was found). The favicon fetch
 * happens server-side in Core behind an SSRF guard; a failure to find an icon
 * is a soft `null`, not an error — the wizard simply falls back to a generated
 * avatar. Requires organizationId so the scraped logo is stored under the org
 * prefix.
 */
export const resolveOrganizationSiteIcon = withSession<
  ResolveOrganizationSiteIconParameters,
  Result<{ url: string | null }, ActionError>
>(async ({ url, organizationId }) => {
  const parsed = resolveSiteIconSchema.safeParse({ url, organizationId });
  if (!parsed.success) {
    return Err({
      code: CommonErrorCode.BAD_INPUT,
      message: parsed.error.issues[0]?.message,
    });
  }

  try {
    const { data } = await coreClient.resolveSiteIcon(
      parsed.data.url,
      parsed.data.organizationId,
    );
    return Ok({ url: data.url });
  } catch (error) {
    if (error instanceof CoreApiRequestError && error.status === 400) {
      return Err({ code: CommonErrorCode.BAD_INPUT, message: error.message });
    }
    console.error("Failed to resolve organization site icon", error);
    return Err({ code: CommonErrorCode.INTERNAL_SERVER_ERROR });
  }
});

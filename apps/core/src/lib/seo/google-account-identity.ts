import { z } from "@hono/zod-openapi";

import {
  projectComposioFetch,
  projectComposioResponse,
} from "@/clients/composio.client";
import { captureExternalServiceError } from "@/lib/external-service-errors";

export interface GoogleAccountIdentity {
  email: string;
  name: string | null;
  pictureUrl: string | null;
}

// The connected Google toolkit keeps googleapis.com, so Composio proxies it.
const GOOGLE_USERINFO_ENDPOINT =
  "https://www.googleapis.com/oauth2/v3/userinfo";
/** Display data only: a slow read must not hold a status request for long. */
const IDENTITY_READ_TIMEOUT_MS = 5_000;
const MAX_EMAIL_LENGTH = 320;
const MAX_NAME_LENGTH = 200;
const MAX_PICTURE_URL_LENGTH = 2_048;
const GOOGLE_PICTURE_HOST_SUFFIX = ".googleusercontent.com";
/** Google refuses the read when the consent lacks the email or profile scope. */
const SCOPE_REFUSAL_STATUSES = new Set([401, 403]);
const IDENTITY_FAILURE_LABEL = "seo_google_account_identity";

const proxyResponseSchema = z.object({ status: z.number(), data: z.unknown() });
const pictureSchema = z
  .string()
  .max(MAX_PICTURE_URL_LENGTH)
  .refine((value) => {
    const url = URL.parse(value);
    return (
      url?.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.hostname.endsWith(GOOGLE_PICTURE_HOST_SUFFIX)
    );
  });
const userinfoSchema = z.object({
  email: z.email().max(MAX_EMAIL_LENGTH),
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH).nullable().catch(null),
  picture: pictureSchema.nullable().catch(null),
});

/** Never throws: the identity is display data and must not fail a connection. */
export async function readGoogleAccountIdentity(input: {
  connectedAccountId: string;
  executorUserId: string;
  signal?: AbortSignal;
}): Promise<GoogleAccountIdentity | null> {
  try {
    const response = await projectComposioFetch("/api/v3/tools/execute/proxy", {
      method: "POST",
      signal: input.signal,
      timeoutMs: IDENTITY_READ_TIMEOUT_MS,
      jsonBody: {
        connected_account_id: input.connectedAccountId,
        user_id: input.executorUserId,
        endpoint: GOOGLE_USERINFO_ENDPOINT,
        method: "GET",
      },
    });
    const proxied = proxyResponseSchema.safeParse(
      await projectComposioResponse<unknown>(
        response,
        "read Google account identity",
      ),
    );
    if (!proxied.success)
      throw new Error("Google account identity proxy response is malformed");
    const { status, data } = proxied.data;
    if (SCOPE_REFUSAL_STATUSES.has(status)) return null;
    if (status < 200 || status >= 300)
      throw new Error(`Google account identity read failed (${status})`);
    const parsed = userinfoSchema.safeParse(data);
    // No valid email is a consent without the email scope, as with a refusal. The body holds
    // personal data, so it stays out of reports.
    if (!parsed.success) return null;
    return {
      email: parsed.data.email,
      name: parsed.data.name,
      pictureUrl: parsed.data.picture,
    };
  } catch (error) {
    captureExternalServiceError(error, { label: IDENTITY_FAILURE_LABEL });
    return null;
  }
}

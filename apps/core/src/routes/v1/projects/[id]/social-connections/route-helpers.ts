import { HTTPException } from "hono/http-exception";

import {
  ComposioApiError,
  ComposioConfigError,
  ComposioIdentityError,
} from "@/clients/composio.client";
import { ZernioApiError } from "@/clients/zernio.client";
import {
  badRequest,
  integrationNotConfigured,
  internalServerError,
  serviceUnavailable,
} from "@/helpers/error";

export function mapProjectSocialConnectionServiceError(error: unknown): never {
  if (error instanceof HTTPException) throw error;
  if (error instanceof ComposioConfigError) {
    throw integrationNotConfigured();
  }
  if (error instanceof ComposioIdentityError) {
    throw badRequest(error.message, error.kind ? { kind: error.kind } : {});
  }
  if (error instanceof ComposioApiError || error instanceof ZernioApiError) {
    const status =
      error instanceof ZernioApiError ? error.status : error.httpStatus;
    if (status >= 500 || status === 401 || status === 403 || status === 429) {
      throw serviceUnavailable("Integrations are temporarily unavailable.");
    }
    throw badRequest("Unable to complete the social account action.");
  }
  throw internalServerError("Unable to manage social connections.");
}

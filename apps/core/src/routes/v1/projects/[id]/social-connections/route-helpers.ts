import { HTTPException } from "hono/http-exception";

import {
  ComposioApiError,
  ComposioConfigError,
  ComposioIdentityError,
} from "@/clients/composio.client";
import {
  badRequest,
  internalServerError,
  serviceUnavailable,
} from "@/helpers/error";

export function mapProjectSocialConnectionServiceError(error: unknown): never {
  if (error instanceof HTTPException) throw error;
  if (error instanceof ComposioConfigError) {
    throw serviceUnavailable("Integrations are not configured on this server.");
  }
  if (error instanceof ComposioIdentityError) {
    throw badRequest(error.message, error.kind ? { kind: error.kind } : {});
  }
  if (error instanceof ComposioApiError) {
    if (
      error.httpStatus >= 500 ||
      error.httpStatus === 401 ||
      error.httpStatus === 403 ||
      error.httpStatus === 429
    ) {
      throw serviceUnavailable("Integrations are temporarily unavailable.");
    }
    throw badRequest("Unable to complete the social account action.");
  }
  throw internalServerError("Unable to manage social connections.");
}

import { HTTPException } from "hono/http-exception";

import {
  ComposioApiError,
  ComposioConfigError,
} from "@/clients/composio.client";
import { ComposioToolError } from "@/clients/social-post-providers/tools";
import {
  badGateway,
  integrationNotConfigured,
  internalServerError,
} from "@/helpers/error";

export function mapAdsServiceError(error: unknown): never {
  if (error instanceof HTTPException) throw error;
  if (error instanceof ComposioConfigError) {
    throw integrationNotConfigured();
  }
  if (error instanceof ComposioApiError || error instanceof ComposioToolError) {
    throw badGateway("The ads provider could not complete the request.");
  }
  throw internalServerError("Unable to complete the ads request.");
}

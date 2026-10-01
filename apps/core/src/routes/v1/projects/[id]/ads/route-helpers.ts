import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";

import {
  ComposioApiError,
  ComposioConfigError,
} from "@/clients/composio.client";
import { ComposioToolError } from "@/clients/social-post-providers/tools";
import {
  badGateway,
  internalServerError,
  serviceUnavailable,
} from "@/helpers/error";

export function mapAdsServiceError(error: unknown): never {
  if (error instanceof HTTPException) throw error;
  if (error instanceof ComposioConfigError) {
    throw serviceUnavailable(
      "Ads integrations are not configured on this server.",
      {
        kind: CORE_API_ERROR_KINDS.INTEGRATION_NOT_CONFIGURED,
      },
    );
  }
  if (error instanceof ComposioApiError || error instanceof ComposioToolError) {
    throw badGateway("The ads provider could not complete the request.");
  }
  throw internalServerError("Unable to complete the ads request.");
}

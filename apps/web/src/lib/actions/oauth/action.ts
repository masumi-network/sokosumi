"use server";

import { type ActionError, CommonErrorCode } from "@/lib/actions";
import { getSession } from "@/lib/auth/auth.server";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import { Err, Ok, type Result } from "@/lib/ts-res";

/**
 * Revokes OAuth client access by deleting consent, revoking refresh tokens, and deleting access tokens.
 *
 * @param consentId - The ID of the consent to revoke
 * @param clientId - The client ID associated with the consent
 * @returns Result indicating success or failure
 */
export async function revokeOAuthClientAccess(
  consentId: string,
  clientId: string,
): Promise<Result<void, ActionError>> {
  try {
    // Verify user is authenticated
    const session = await getSession();
    if (!session?.user?.id) {
      return Err({
        code: CommonErrorCode.UNAUTHENTICATED,
        message: "You must be authenticated to revoke OAuth access",
      });
    }

    await coreClient.revokeMyOauthConsent(consentId, clientId);

    return Ok(undefined);
  } catch (error) {
    if (error instanceof CoreApiRequestError) {
      switch (error.status) {
        case 400:
          return Err({
            code: CommonErrorCode.BAD_INPUT,
            message: "Client ID does not match the consent",
          });
        case 403:
          return Err({
            code: CommonErrorCode.UNAUTHORIZED,
            message: "You can only revoke your own OAuth consents",
          });
        case 404:
          return Err({
            code: CommonErrorCode.BAD_INPUT,
            message: "Consent not found",
          });
      }
    }

    console.error("Failed to revoke OAuth client access", error);
    return Err({
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      message: "Failed to revoke OAuth client access",
    });
  }
}

"use server";

import { ActionError, CommonErrorCode } from "@/lib/actions";
import { getSession } from "@/lib/auth/utils";
import prisma from "@/lib/db/prisma";
import { Err, Ok, Result } from "@/lib/ts-res";

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

    const userId = session.user.id;

    // Verify the consent belongs to the current user
    const consent = await prisma.oauthConsent.findUnique({
      where: { id: consentId },
    });

    if (!consent) {
      return Err({
        code: CommonErrorCode.BAD_INPUT,
        message: "Consent not found",
      });
    }

    if (consent.userId !== userId) {
      return Err({
        code: CommonErrorCode.UNAUTHORIZED,
        message: "You can only revoke your own OAuth consents",
      });
    }

    if (consent.clientId !== clientId) {
      return Err({
        code: CommonErrorCode.BAD_INPUT,
        message: "Client ID does not match the consent",
      });
    }

    // Perform all revocation steps in a transaction
    await prisma.$transaction(async (tx) => {
      // 1. Delete the consent
      await tx.oauthConsent.delete({
        where: { id: consentId },
      });

      // 2. Revoke all refresh tokens for this client/user
      await tx.oauthRefreshToken.updateMany({
        where: {
          userId: userId,
          clientId: clientId,
          revoked: null, // Only revoke tokens that aren't already revoked
        },
        data: {
          revoked: new Date(),
        },
      });

      // 3. Delete all access tokens for this client/user
      await tx.oauthAccessToken.deleteMany({
        where: {
          userId: userId,
          clientId: clientId,
        },
      });
    });

    return Ok(undefined);
  } catch (error) {
    console.error("Failed to revoke OAuth client access", error);
    return Err({
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      message: "Failed to revoke OAuth client access",
    });
  }
}

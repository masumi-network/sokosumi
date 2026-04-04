import { notFound, serviceUnavailable } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { refreshAccessToken } from "@/services/google-drive";

/**
 * Reads GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET from process.env.
 * Throws 503 if not configured.
 */
export function getGoogleDriveCredentials(): {
  clientId: string;
  clientSecret: string;
} {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw serviceUnavailable("Google Drive integration is not configured");
  }

  return { clientId, clientSecret };
}

/**
 * Returns a redirect URI for the Google OAuth callback.
 */
export function getGoogleDriveRedirectUri(): string {
  if (process.env.GOOGLE_DRIVE_REDIRECT_URI) {
    return process.env.GOOGLE_DRIVE_REDIRECT_URI;
  }

  const betterAuthUrl =
    process.env.BETTER_AUTH_URL ?? "http://localhost:8787";
  return `${betterAuthUrl}/v1/users/me/google-drive/callback`;
}

/**
 * Returns a valid access token for the given user.
 * Refreshes the token when it is expired or about to expire (within 60 s).
 * Throws 404 if no connection exists.
 */
export async function getValidAccessToken(userId: string): Promise<string> {
  const connection = await prisma.googleDriveConnection.findUnique({
    where: { userId },
  });

  if (!connection) {
    throw notFound("Google Drive is not connected");
  }

  const bufferMs = 60_000; // refresh 60 s before actual expiry
  if (connection.expiresAt.getTime() - Date.now() > bufferMs) {
    return connection.accessToken;
  }

  // Token expired or about to expire -- refresh it
  const { clientId, clientSecret } = getGoogleDriveCredentials();
  const refreshed = await refreshAccessToken(
    connection.refreshToken,
    clientId,
    clientSecret,
  );

  await prisma.googleDriveConnection.update({
    where: { userId },
    data: {
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
    },
  });

  return refreshed.accessToken;
}

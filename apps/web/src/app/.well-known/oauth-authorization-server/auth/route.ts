import { redirectToCoreOAuthWellKnownResponse } from "@/lib/auth/oauth-issuer-well-known.server";

export async function GET() {
  return redirectToCoreOAuthWellKnownResponse();
}

import { forbidden } from "@/helpers/error";
import type { AuthenticationContext } from "@/middleware/auth";

export function requireCoworkerId(authContext: AuthenticationContext): string {
  if (!authContext.coworkerId) {
    throw forbidden("Coworker authentication required");
  }

  return authContext.coworkerId;
}

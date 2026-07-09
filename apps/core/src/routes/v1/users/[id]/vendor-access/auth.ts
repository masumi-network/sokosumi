import { forbidden } from "@/helpers/error";
import {
  type AuthenticationContext,
  requireUserAuthContext,
  type UserAuthenticationContext,
} from "@/middleware/auth";

import {
  requireUserRouteContext,
  type UserRouteContext,
} from "../../user-route-context";

export function requireSelfSessionVendorAccess(
  authContext: AuthenticationContext,
  userRouteContext: UserRouteContext | null,
): { session: UserAuthenticationContext; resolvedUserId: string } {
  const session = requireUserAuthContext(authContext);
  const { resolvedUserId } = requireUserRouteContext(userRouteContext);

  if (resolvedUserId !== session.userId) {
    throw forbidden("You can only manage your own vendor access grants");
  }

  return { session, resolvedUserId };
}

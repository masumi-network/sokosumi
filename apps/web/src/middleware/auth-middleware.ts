import type { Session } from "@sokosumi/utils";
import {
  CoreAuthUnavailableError,
  UnAuthenticatedError,
} from "@/lib/auth/errors";
import { readRouteSession } from "@/lib/auth/route-session";

export interface AuthenticatedRequest {
  session?: Session;
}

export function withSession<T extends AuthenticatedRequest, R>(
  handler: (params: T & { session: Session }) => Promise<R>,
) {
  return async (params: T): Promise<R> => {
    // Always resolve the session server-side. Any client-supplied `session` on
    // the params (these wrappers back `"use server"` actions whose argument is
    // attacker-controllable) is ignored — the trusted session below is spread
    // last so it overrides a forged one, preventing privilege escalation.
    const sessionRead = await readRouteSession();
    // "Core could not be asked" is not "the user is signed out". Throwing
    // UnAuthenticatedError for a stall sends the error boundary to /signin
    // and loses whatever the action was doing.
    if (sessionRead.status === "unavailable") {
      throw new CoreAuthUnavailableError(sessionRead.reason);
    }
    if (sessionRead.status === "signedOut") {
      throw new UnAuthenticatedError();
    }

    return handler({ ...params, session: sessionRead.session });
  };
}

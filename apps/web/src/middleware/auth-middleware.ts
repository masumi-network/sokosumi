import type { Session } from "@sokosumi/utils";
import { getSession } from "@/lib/auth/auth.server";
import { UnAuthenticatedError } from "@/lib/auth/errors";

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
    const session = await getSession();
    if (!session) {
      throw new UnAuthenticatedError();
    }

    return handler({ ...params, session });
  };
}

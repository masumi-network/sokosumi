import { type Session } from "@/lib/auth/auth";
import { UnAuthenticatedError } from "@/lib/auth/errors";
import { getSession } from "@/lib/auth/utils";

export interface AuthenticatedRequest {
  session?: Session;
}

export function withSession<T extends AuthenticatedRequest, R>(
  handler: (params: T & { session: Session }) => Promise<R>,
) {
  return async (params: T): Promise<R> => {
    if (params.session) {
      return handler(params as T & { session: Session });
    }

    const session = await getSession();
    if (!session) {
      throw new UnAuthenticatedError();
    }

    return handler({ ...params, session });
  };
}

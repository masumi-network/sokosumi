import { UnAuthenticatedError } from "@/lib/auth/errors";
import { AuthContext, getAuthContext } from "@/lib/auth/utils";

export interface AuthenticatedRequest {
  authContext?: AuthContext;
}

export function withAuthContext<T extends AuthenticatedRequest, R>(
  handler: (params: T & { authContext: AuthContext }) => Promise<R>,
) {
  return async (params: T): Promise<R> => {
    // If auth is already provided, use it
    if (params.authContext) {
      return handler(params as T & { authContext: AuthContext });
    }

    // Otherwise, get the auth context
    const authContext = await getAuthContext();
    if (!authContext) {
      throw new UnAuthenticatedError();
    }

    return handler({ ...params, authContext });
  };
}

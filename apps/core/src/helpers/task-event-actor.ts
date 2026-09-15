import {
  type AuthenticationContext,
  isSokoBotAuthContext,
  isUserAuthContext,
  requireCoworkerAuthContext,
} from "@/middleware/auth";

export interface TaskEventActorFields {
  userId: string | null;
  coworkerId: string | null;
  sokoBotId: string | null;
}

/**
 * TaskEvent actor columns for the authenticated actor. Agent actors are
 * attributed to their own model, never to the contextual user: `X-Context-*`
 * is workspace scope, not a second actor FK.
 */
export function resolveTaskEventActorFields(
  authContext: AuthenticationContext,
): TaskEventActorFields {
  if (isUserAuthContext(authContext)) {
    return { userId: authContext.userId, coworkerId: null, sokoBotId: null };
  }

  if (isSokoBotAuthContext(authContext)) {
    return {
      userId: null,
      coworkerId: null,
      sokoBotId: authContext.sokoBotId,
    };
  }

  return {
    userId: null,
    coworkerId: requireCoworkerAuthContext(authContext).coworkerId,
    sokoBotId: null,
  };
}

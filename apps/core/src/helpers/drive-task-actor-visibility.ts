import { type Prisma, TaskStatus } from "@sokosumi/database";
import {
  buildHumanTaskVisibilityWhere,
  buildSokoBotOwnerTaskVisibilityWhere,
} from "@/helpers/task-visibility";
import {
  type AuthenticationContext,
  isCoworkerAuthContext,
  isSokoBotAuthContext,
  requirePersonalSokoBotAuthContext,
} from "@/middleware/auth";

/**
 * Drive task filter for the caller: a person sees what Task visibility allows,
 * a personal Soko Bot its own non-draft tasks under its owner's visibility.
 * A coworker gets nothing here; its access filter is applied separately. A
 * shared Soko Bot has no visibility rule yet, so it gets 403.
 */
export function driveActorTaskWhere(
  authContext: AuthenticationContext,
  readerUserId: string,
): Prisma.TaskWhereInput {
  if (isCoworkerAuthContext(authContext)) {
    return {};
  }
  if (isSokoBotAuthContext(authContext)) {
    const sokoBot = requirePersonalSokoBotAuthContext(authContext);
    return {
      assigneeSokoBotId: sokoBot.sokoBotId,
      status: { not: TaskStatus.DRAFT },
      AND: [buildSokoBotOwnerTaskVisibilityWhere(sokoBot.userId)],
    };
  }
  return { AND: [buildHumanTaskVisibilityWhere(readerUserId)] };
}

/** The {@link driveActorTaskWhere} rule as Drive project page parameters. */
export function driveActorProjectPageParams(
  authContext: AuthenticationContext,
  readerUserId: string,
):
  | { assigneeSokoBotId: string; sokoBotOwnerUserId: string }
  | { readerUserId: string }
  | Record<string, never> {
  if (isCoworkerAuthContext(authContext)) {
    return {};
  }
  if (isSokoBotAuthContext(authContext)) {
    const sokoBot = requirePersonalSokoBotAuthContext(authContext);
    return {
      assigneeSokoBotId: sokoBot.sokoBotId,
      sokoBotOwnerUserId: sokoBot.userId,
    };
  }
  return { readerUserId };
}

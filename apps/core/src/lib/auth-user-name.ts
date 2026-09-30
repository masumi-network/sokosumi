import {
  isFirstAndLastNameWithinLimit,
  joinFirstAndLastName,
  USER_NAME_MAX_LENGTH,
} from "@sokosumi/utils";
import type { GenericEndpointContext } from "better-auth";
import { APIError, getAuthoritativeSessionFromCtx } from "better-auth/api";

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function validateUserNameLength(
  firstName: unknown,
  lastName: unknown,
): void {
  if (
    !isFirstAndLastNameWithinLimit(
      trimmedString(firstName),
      trimmedString(lastName),
    )
  ) {
    throw new APIError("BAD_REQUEST", {
      code: "NAME_TOO_LONG",
      message: `First and last name together must be at most ${USER_NAME_MAX_LENGTH} characters, including the space`,
    });
  }
}

/** Partial profile updates must include the persisted counterpart in the check. */
export async function validateUpdatedUserName(
  ctx: GenericEndpointContext,
): Promise<void> {
  if (ctx.body?.firstName === undefined && ctx.body?.lastName === undefined) {
    return;
  }

  const session = await getAuthoritativeSessionFromCtx(ctx);
  if (!session) {
    return; // The endpoint's session middleware rejects unauthenticated requests.
  }

  validateUserNameLength(
    ctx.body?.firstName === undefined
      ? session.user.firstName
      : ctx.body.firstName,
    ctx.body?.lastName === undefined
      ? session.user.lastName
      : ctx.body.lastName,
  );
}

/**
 * Email sign-up takes a first and a last name; the display `name` starts as
 * the two joined and is the user's to change afterwards. Better Auth's own
 * body schema still requires `name`, so the before hook hands it this body
 * and the request needs none.
 */
export function resolveSignUpNameBody(
  body: Record<string, unknown> | undefined,
) {
  const firstName = trimmedString(body?.firstName);
  const lastName = trimmedString(body?.lastName);
  if (!firstName || !lastName) {
    throw new APIError("BAD_REQUEST", {
      code: "NAME_REQUIRED",
      message: "First name and last name are required",
    });
  }

  validateUserNameLength(firstName, lastName);

  return {
    ...body,
    firstName,
    lastName,
    name: joinFirstAndLastName(firstName, lastName),
  };
}

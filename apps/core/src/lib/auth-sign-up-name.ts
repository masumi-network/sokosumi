import { joinFirstAndLastName } from "@sokosumi/utils";
import { APIError } from "better-auth/api";

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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

  return {
    ...body,
    firstName,
    lastName,
    name: joinFirstAndLastName(firstName, lastName),
  };
}

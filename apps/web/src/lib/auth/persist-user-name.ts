import { joinFirstAndLastName } from "@sokosumi/utils";
import { err, ok, type Result } from "neverthrow";

import { authClient } from "@/lib/auth/auth.client";
import type { FirstAndLastNameFormType } from "@/lib/schemas/account";

export function userHasName(name: string | null | undefined): boolean {
  return Boolean(name?.trim());
}

export async function persistFirstAndLastName(
  { firstName, lastName }: FirstAndLastNameFormType,
  currentName: string | null | undefined,
): Promise<Result<void, string | undefined>> {
  try {
    let name = currentName;
    if (!userHasName(name)) {
      // Onboarding and invite retries can retain a nameless initial session.
      // Read the stored name before deriving it again, including across tabs.
      const session = await authClient.getSession({
        query: { disableCookieCache: true },
      });
      if (session.error || !session.data) {
        return err(session.error?.message);
      }
      name = session.data.user.name;
    }
    const result = await authClient.updateUser({
      firstName,
      lastName,
      // The display name is derived once, for a user who has none. After that
      // it is theirs to edit and the parts no longer touch it.
      ...(userHasName(name)
        ? {}
        : { name: joinFirstAndLastName(firstName, lastName) }),
    });
    if (result.error) {
      return err(result.error.message);
    }
    return ok(undefined);
  } catch (error) {
    console.error("Persist first and last name failed", error);
    return err(undefined);
  }
}

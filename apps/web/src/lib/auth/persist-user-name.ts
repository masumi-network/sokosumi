import { err, ok, type Result } from "neverthrow";

import { authClient } from "@/lib/auth/auth.client";

export function userHasName(name: string | null | undefined): boolean {
  return Boolean(name?.trim());
}

export async function persistUserName(
  name: string,
): Promise<Result<void, string | undefined>> {
  try {
    const result = await authClient.updateUser({ name });
    if (result.error) {
      return err(result.error.message);
    }
    return ok(undefined);
  } catch (error) {
    console.error("Persist user name failed", error);
    return err(undefined);
  }
}

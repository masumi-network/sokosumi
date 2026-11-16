import { getFirstName } from "@sokosumi/utils";

/** Given name for the landing greeting. Null → nameless greeting. */
export function resolveLandingGreetingName(
  userName: null | string | undefined,
): string | null {
  return getFirstName(userName) ?? null;
}

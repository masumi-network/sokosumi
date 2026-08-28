import { isNmkrEmail } from "@sokosumi/utils";

/**
 * Email domains allowed to use beta features.
 */
export function isBetaAccessEmail(email: string | null | undefined): boolean {
  return isNmkrEmail(email);
}

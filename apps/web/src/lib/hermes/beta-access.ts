import { isNmkrEmail } from "@sokosumi/utils";

/**
 * Email domains allowed to use the Hermes beta (sidebar entry + page).
 * Everyone else gets a 404 on /personal-assistant and no nav item —
 * activation itself additionally stays behind the Core paid-plan gate.
 */
export function isHermesBetaAccessEmail(
  email: string | null | undefined,
): boolean {
  return isNmkrEmail(email);
}

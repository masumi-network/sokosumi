/**
 * Platform admin check shared by Core and web. Better Auth stores the
 * platform role as a comma-separated string; "admin" anywhere in the
 * list grants platform administration.
 */
export function hasAdminRole(role: string | null | undefined): boolean {
  return (
    role?.split(",").some((value) => value.trim().toLowerCase() === "admin") ??
    false
  );
}

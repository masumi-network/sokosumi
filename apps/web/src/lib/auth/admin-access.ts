import "server-only";

import { notFound } from "next/navigation";

import type { Session } from "@/lib/auth/auth";
import { hasAdminRole } from "@/lib/auth/has-admin-role";
import { getSessionOrRedirect } from "@/lib/auth/utils";

export { hasAdminRole } from "@/lib/auth/has-admin-role";

function getSessionUserRole(session: Session): string | null | undefined {
  const user = session.user as Session["user"] & { role?: string | null };
  return user.role ?? undefined;
}

export async function requireAdminSession(): Promise<Session> {
  const session = await getSessionOrRedirect();

  if (!hasAdminRole(getSessionUserRole(session))) {
    notFound();
  }

  return session;
}

export function assertAdminSession(session: Session): void {
  if (!hasAdminRole(getSessionUserRole(session))) {
    throw new Error("Admin access required");
  }
}

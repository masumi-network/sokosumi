import "server-only";

import { notFound } from "next/navigation";

import type { Session } from "@/lib/auth/auth";
import { AdminAccessRequiredError } from "@/lib/auth/errors";
import { hasAdminRole } from "@/lib/auth/has-admin-role";
import { getSessionOrRedirect } from "@/lib/auth/utils";

export { hasAdminRole } from "@/lib/auth/has-admin-role";

function getSessionUserRole(session: Session): string | null | undefined {
  const user = session.user as Session["user"] & { role?: string | null };
  return user.role ?? undefined;
}

export function isAdminSession(session: Session | null): boolean {
  return session !== null && hasAdminRole(getSessionUserRole(session));
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
    throw new AdminAccessRequiredError();
  }
}

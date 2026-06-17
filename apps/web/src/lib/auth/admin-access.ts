import "server-only";

import type { Session } from "@sokosumi/utils";
import { notFound } from "next/navigation";
import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import { AdminAccessRequiredError } from "@/lib/auth/errors";
import { hasAdminRole } from "@/lib/auth/has-admin-role";

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
    throw new AdminAccessRequiredError();
  }
}

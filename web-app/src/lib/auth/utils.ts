import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth, Session, User } from "@/lib/auth/auth";

export async function requireAuthentication(): Promise<{
  session: Session;
}> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login");
  }

  return { session };
}

export async function getAuthenticatedUser(): Promise<User | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return null;
  }

  return session.user;
}

export async function verifyUserAuthentication(
  userId: string,
): Promise<boolean> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return false;
  }
  if (user.id !== userId) {
    return false;
  }

  return true;
}

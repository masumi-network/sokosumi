import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth, Session } from "@/lib/auth/auth";

export async function requireAuthentication(): Promise<{
  session: Session;
}> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/signin");
  }

  return { session };
}

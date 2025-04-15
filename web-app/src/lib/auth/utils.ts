import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getEnvSecrets } from "@/config/env.config";
import { auth, Session } from "@/lib/auth/auth";
import { createHash } from "@/lib/utils";

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

export const compareApiKeys = (apiKey: string) => {
  const envApiKey = getEnvSecrets().ADMIN_KEY;
  return createHash(apiKey) === createHash(envApiKey);
};

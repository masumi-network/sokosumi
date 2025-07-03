import "server-only";

import { getSession } from "@/lib/auth/utils";
import { retrieveUserById } from "@/lib/db/repositories";
import { User } from "@/prisma/generated/client";

export async function getAuthenticatedUser(): Promise<User | null> {
  const session = await getSession();
  if (!session) {
    return null;
  }

  const user = await retrieveUserById(session.user.id);
  return user;
}

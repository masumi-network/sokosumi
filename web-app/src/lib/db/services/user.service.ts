import { User } from "@prisma/client";

import prisma from "@/lib/db/prisma";

export async function getUserByEmail(email: string): Promise<User | null> {
  const user = await prisma.user.findUnique({
    where: { email },
  });

  return user;
}

export async function getUserById(id: string): Promise<User | null> {
  const user = await prisma.user.findUnique({
    where: { id },
  });

  return user;
}

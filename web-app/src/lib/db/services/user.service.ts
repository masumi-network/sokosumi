import { createUserDTO, UserDTO } from "@/lib/db/dto/UserDTO";
import prisma from "@/lib/db/prisma";

export async function getUserByEmail(email: string): Promise<UserDTO | null> {
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    return null;
  }

  return createUserDTO(user);
}

export async function getUserById(id: string): Promise<UserDTO | null> {
  const user = await prisma.user.findUnique({
    where: { id },
  });

  if (!user) {
    return null;
  }

  return createUserDTO(user);
}

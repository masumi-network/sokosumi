import { User } from "@prisma/client";

export interface UserDTO {
  id: string;
  name: string;
  email: string;
  credits: number;
}

export async function createUserDTO(user: User): Promise<UserDTO> {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    credits: reduceByMillion(Number(user.credits)),
  };
}

function reduceByMillion(value: number): number {
  return value / 10 ** 6;
}

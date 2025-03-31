import { User } from "@prisma/client";

export function getCredits(user: User) {
  return reduceByMillion(Number(user.credits));
}

function reduceByMillion(value: number): number {
  return value / 10 ** 6;
}

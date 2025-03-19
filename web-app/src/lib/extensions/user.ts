import { User } from "../auth.client";

export function getInitials(user: User): string {
  return user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

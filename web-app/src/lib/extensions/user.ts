import { User } from "../better-auth/auth";

export function getInitials(user: User): string {
  return user.name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0] || "")
    .join("")
    .toUpperCase();
}

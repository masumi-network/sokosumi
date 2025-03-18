export interface User {
  name: string;
  email: string;
  image?: string | null;
}

export function getInitials(user: User): string {
  return user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

export interface User {
  id: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  name: string | null;
  email: string | null;
  termsAccepted: boolean;
  marketingOptIn: boolean;
  stripeCustomerId: string | null;
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

export function parseUser(input: unknown): User {
  const value = asRecord(input);
  return {
    id: typeof value.id === "string" ? value.id : null,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : null,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
    name: typeof value.name === "string" ? value.name : null,
    email: typeof value.email === "string" ? value.email : null,
    termsAccepted:
      typeof value.termsAccepted === "boolean" ? value.termsAccepted : false,
    marketingOptIn:
      typeof value.marketingOptIn === "boolean" ? value.marketingOptIn : false,
    stripeCustomerId:
      typeof value.stripeCustomerId === "string"
        ? value.stripeCustomerId
        : null,
  };
}

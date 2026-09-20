export interface Vendor {
  id: string;
  createdAt: string | null;
  updatedAt: string | null;
  name: string | null;
  slug: string | null;
  logos: {
    light: string | null;
    dark: string | null;
  };
  role: string | null;
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requiredIdentity(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid vendor response: missing ${field}`);
  }
  return value;
}

export function parseVendor(input: unknown): Vendor {
  const value = asRecord(input);
  const logos = asRecord(value.logos);
  return {
    id: requiredIdentity(value.id, "id"),
    createdAt: nullableString(value.createdAt),
    updatedAt: nullableString(value.updatedAt),
    name: nullableString(value.name),
    slug: nullableString(value.slug),
    logos: {
      light: nullableString(logos.light),
      dark: nullableString(logos.dark),
    },
    role: nullableString(value.role),
  };
}

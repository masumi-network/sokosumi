export interface Category {
  id: string | null;
  name: string | null;
  description: string | null;
  slug: string | null;
  agentCount: number;
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

export function parseCategory(input: unknown): Category {
  const value = asRecord(input);
  return {
    id: typeof value.id === "string" ? value.id : null,
    name: typeof value.name === "string" ? value.name : null,
    description:
      typeof value.description === "string" ? value.description : null,
    slug: typeof value.slug === "string" ? value.slug : null,
    agentCount:
      typeof value.agentCount === "number" && Number.isFinite(value.agentCount)
        ? value.agentCount
        : 0,
  };
}

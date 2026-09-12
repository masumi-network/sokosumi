export interface AgentTag {
  name: string | null;
}

export interface AgentPrice {
  credits: number | null;
  includedFee: number | null;
}

export interface Agent {
  id: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  name: string | null;
  description: string | null;
  status: string | null;
  isNew: boolean;
  isShown: boolean;
  price: AgentPrice;
  tags: AgentTag[];
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseTag(input: unknown): AgentTag {
  const record = asRecord(input);
  return { name: nullableString(record.name) };
}

export function parseAgent(input: unknown): Agent {
  const record = asRecord(input);
  const price = asRecord(record.price ?? record.pricing);
  const rawTags = Array.isArray(record.tags)
    ? record.tags
    : Array.isArray(record.categories)
      ? record.categories
      : [];

  return {
    id: nullableString(record.id),
    createdAt: nullableString(record.createdAt),
    updatedAt: nullableString(record.updatedAt),
    name: nullableString(record.name),
    description: nullableString(record.description),
    status: nullableString(record.status),
    isNew: typeof record.isNew === "boolean" ? record.isNew : false,
    isShown: typeof record.isShown === "boolean" ? record.isShown : false,
    price: {
      credits: nullableNumber(price.credits ?? record.credits),
      includedFee: nullableNumber(price.includedFee ?? record.includedFee),
    },
    tags: rawTags.map(parseTag),
  };
}

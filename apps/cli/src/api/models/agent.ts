import { asRecord, nullableNumber, nullableString } from "./parse-helpers.js";

export interface Agent {
  id: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  name: string | null;
  description: string | null;
  credits: number | null;
  tags: string[];
}

function parseDisplayTag(input: unknown): string | null {
  if (typeof input === "string") return input;
  return nullableString(asRecord(input).name);
}

function parseDisplayTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const tags: string[] = [];
  for (const item of input) {
    const name = parseDisplayTag(item);
    if (name) tags.push(name);
  }
  return tags;
}

export function parseAgent(input: unknown): Agent {
  const record = asRecord(input);
  return {
    id: nullableString(record.id),
    createdAt: nullableString(record.createdAt),
    updatedAt: nullableString(record.updatedAt),
    name: nullableString(record.name),
    description: nullableString(record.description),
    credits: nullableNumber(record.credits),
    tags: parseDisplayTags(record.categories),
  };
}

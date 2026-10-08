import { asRecord } from "./parse-helpers.js";
import { parseVendor, type Vendor } from "./vendor.js";

export interface Coworker {
  id: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  archivedAt: string | null;
  priority: number;
  slug: string | null;
  name: string | null;
  vendor: Vendor | null;
  caption: string | null;
  url: string | null;
  baseURL: string | null;
  description: string | null;
  image: string | null;
  metadata: Record<string, unknown> | null;
  isWhitelisted: boolean;
  capabilities: unknown[];
}

export interface CoworkerApiKey {
  id: string | null;
  token: string | null;
  name: string | null;
  expiresAt: string | null;
}

export function parseCoworker(input: unknown): Coworker {
  const value = asRecord(input);
  const metadata = value.metadata;
  return {
    id: typeof value.id === "string" ? value.id : null,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : null,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
    archivedAt: typeof value.archivedAt === "string" ? value.archivedAt : null,
    priority:
      typeof value.priority === "number" && Number.isInteger(value.priority)
        ? value.priority
        : 0,
    slug: typeof value.slug === "string" ? value.slug : null,
    name: typeof value.name === "string" ? value.name : null,
    vendor: value.vendor == null ? null : parseVendor(value.vendor),
    caption: typeof value.caption === "string" ? value.caption : null,
    url: typeof value.url === "string" ? value.url : null,
    baseURL: typeof value.baseURL === "string" ? value.baseURL : null,
    description:
      typeof value.description === "string" ? value.description : null,
    image: typeof value.image === "string" ? value.image : null,
    metadata:
      metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : null,
    isWhitelisted:
      typeof value.isWhitelisted === "boolean" ? value.isWhitelisted : false,
    capabilities: Array.isArray(value.capabilities) ? value.capabilities : [],
  };
}

export function parseCoworkerApiKey(input: unknown): CoworkerApiKey {
  const value = asRecord(input);
  return {
    id: typeof value.id === "string" ? value.id : null,
    token: typeof value.token === "string" ? value.token : null,
    name: typeof value.name === "string" ? value.name : null,
    expiresAt: typeof value.expiresAt === "string" ? value.expiresAt : null,
  };
}

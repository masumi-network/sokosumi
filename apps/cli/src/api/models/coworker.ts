export interface CoworkerPrice {
  credits: number | null;
  includedFee: number | null;
}

export interface Coworker {
  id: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  archivedAt: string | null;
  priority: number;
  slug: string | null;
  name: string | null;
  caption: string | null;
  company: string | null;
  companyLogo: string | null;
  url: string | null;
  baseURL: string | null;
  email: string | null;
  description: string | null;
  image: string | null;
  metadata: Record<string, unknown> | null;
  status: string | null;
  isNew: boolean;
  isShown: boolean;
  isWhitelisted: boolean;
  price: CoworkerPrice;
  capabilities: unknown[];
  estimatedDuration: string | number | null;
}

export interface CoworkerApiKey {
  id: string | null;
  token: string | null;
  name: string | null;
  expiresAt: string | null;
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

export function parseCoworker(input: unknown): Coworker {
  const value = asRecord(input);
  const price = asRecord(value.price);
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
    caption: typeof value.caption === "string" ? value.caption : null,
    company: typeof value.company === "string" ? value.company : null,
    companyLogo:
      typeof value.companyLogo === "string" ? value.companyLogo : null,
    url: typeof value.url === "string" ? value.url : null,
    baseURL: typeof value.baseURL === "string" ? value.baseURL : null,
    email: typeof value.email === "string" ? value.email : null,
    description:
      typeof value.description === "string" ? value.description : null,
    image: typeof value.image === "string" ? value.image : null,
    metadata:
      metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : null,
    status: typeof value.status === "string" ? value.status : null,
    isNew: typeof value.isNew === "boolean" ? value.isNew : false,
    isShown: typeof value.isShown === "boolean" ? value.isShown : false,
    isWhitelisted:
      typeof value.isWhitelisted === "boolean" ? value.isWhitelisted : false,
    price: {
      credits:
        typeof price.credits === "number" && Number.isFinite(price.credits)
          ? price.credits
          : null,
      includedFee:
        typeof price.includedFee === "number" &&
        Number.isFinite(price.includedFee)
          ? price.includedFee
          : null,
    },
    capabilities: Array.isArray(value.capabilities) ? value.capabilities : [],
    estimatedDuration:
      typeof value.estimatedDuration === "string" ||
      typeof value.estimatedDuration === "number"
        ? value.estimatedDuration
        : null,
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

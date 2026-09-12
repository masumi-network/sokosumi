export interface JobFile {
  id: string | null;
  name: string | null;
  url: string | null;
  size: number | null;
  mimeType: string | null;
  status: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface JobLink {
  id: string | null;
  title: string | null;
  url: string | null;
  description: string | null;
  createdAt: string | null;
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

export function parseJobFile(input: unknown): JobFile {
  const value = asRecord(input);
  const fileUrl = typeof value.fileUrl === "string" ? value.fileUrl : null;
  const sourceUrl =
    typeof value.sourceUrl === "string" ? value.sourceUrl : null;
  return {
    id: typeof value.id === "string" ? value.id : null,
    name: typeof value.name === "string" ? value.name : null,
    url: fileUrl || sourceUrl,
    size:
      typeof value.size === "number" && Number.isFinite(value.size)
        ? value.size
        : null,
    mimeType: typeof value.mimeType === "string" ? value.mimeType : null,
    status: typeof value.status === "string" ? value.status : null,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : null,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
  };
}

export function parseJobLink(input: unknown): JobLink {
  const value = asRecord(input);
  return {
    id: typeof value.id === "string" ? value.id : null,
    title: typeof value.title === "string" ? value.title : null,
    url: typeof value.url === "string" ? value.url : null,
    description:
      typeof value.description === "string" ? value.description : null,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : null,
  };
}

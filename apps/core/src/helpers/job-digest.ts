import { AgentJobStatus } from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/utils";

export interface JobInputDetail {
  label: string;
  value: string;
}

export interface JobInputRequestField {
  id: string;
  type: string;
  name: string;
  description: string | null;
  required: boolean;
  options: string[];
}

export interface JobDigest {
  status: SokosumiJobStatus;
  input: JobInputDetail[];
  inputRequest: {
    eventId: string;
    fields: JobInputRequestField[];
    schema: unknown;
  } | null;
  result: string | null;
  resultTruncated: boolean;
  error: string | null;
  files: { name: string; mimeType: string | null; url: string }[];
  links: { title: string | null; url: string }[];
}

/** The parts of a status-mapped Job (`mapJobWithStatus`) a digest reads. */
export interface DigestibleJob {
  status: SokosumiJobStatus;
  input: string | null;
  inputSchema: string | null;
  result: string | null;
  /** Newest first. */
  events: {
    id: string;
    status: AgentJobStatus;
    result: string | null;
    inputSchema: string | null;
    blobs: {
      status: string;
      fileUrl: string | null;
      name: string | null;
      mimeType: string | null;
    }[];
    links: { title: string | null; url: string }[];
  }[];
}

const DETAIL_VALUE_LIMIT = 300;
const MAX_DETAILS = 6;

type SchemaField = Record<string, unknown> & { id: string; name?: unknown };

function parseJson(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Fields of a MIP-003 input schema: a list, `input_data`, or `input_groups`. */
function schemaFields(schema: unknown): SchemaField[] {
  const lists = Array.isArray(schema)
    ? [schema]
    : isRecord(schema)
      ? [
          schema.input_data,
          ...(Array.isArray(schema.input_groups)
            ? schema.input_groups.map((group) =>
                isRecord(group) ? group.input_data : null,
              )
            : []),
        ]
      : [];
  return lists.flatMap((list) =>
    Array.isArray(list)
      ? list.filter(
          (field): field is SchemaField =>
            isRecord(field) && typeof field.id === "string",
        )
      : [],
  );
}

function humanize(id: string): string {
  const words = id.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

function displayValue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value)) {
    const parts = value.map(displayValue).filter((part) => part !== null);
    return parts.length ? parts.join(", ") : null;
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).replace(/\s+/g, " ").trim() || null;
}

/** The hire input as labelled values, named by the Agent's own schema. */
export function describeJobInput(
  input: string | null,
  inputSchema: string | null,
): JobInputDetail[] {
  const values = parseJson(input);
  if (!isRecord(values)) {
    const text = input?.replace(/\s+/g, " ").trim();
    return text
      ? [{ label: "Input", value: clip(text, DETAIL_VALUE_LIMIT) }]
      : [];
  }
  const labels = new Map(
    schemaFields(parseJson(inputSchema)).map((field) => [
      field.id,
      typeof field.name === "string" && field.name.trim()
        ? field.name.trim()
        : humanize(field.id),
    ]),
  );
  return Object.entries(values)
    .flatMap(([key, raw]) => {
      const value = displayValue(raw);
      return value
        ? [
            {
              label: clip(labels.get(key) ?? humanize(key), 120),
              value: clip(value, DETAIL_VALUE_LIMIT),
            },
          ]
        : [];
    })
    .slice(0, MAX_DETAILS);
}

function requestField(field: SchemaField): JobInputRequestField {
  const data = isRecord(field.data) ? field.data : {};
  const validations = Array.isArray(field.validations) ? field.validations : [];
  const optional = validations.some(
    (rule) =>
      isRecord(rule) &&
      rule.validation === "optional" &&
      String(rule.value) === "true",
  );
  return {
    id: field.id,
    type: typeof field.type === "string" ? field.type : "string",
    name:
      typeof field.name === "string" && field.name.trim()
        ? field.name.trim()
        : humanize(field.id),
    description: typeof data.description === "string" ? data.description : null,
    required: !optional,
    options: Array.isArray(data.values)
      ? data.values.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  };
}

/** Markdown reduced to readable plain text for a short preview. */
export function plainExcerpt(text: string, limit: number): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>)\s*/gm, "")
    .replace(/(\*\*|__|`)/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return clip(plain, limit);
}

const RESULT_LIMIT = 6000;

/** What a hired Agent's Job holds now: status, brief, request, result, files. */
export function digestJob(job: DigestibleJob): JobDigest {
  const latest = job.events[0];
  const awaiting =
    job.status === SokosumiJobStatus.INPUT_REQUIRED &&
    latest?.status === AgentJobStatus.AWAITING_INPUT
      ? latest
      : null;
  const failed = job.events.find(
    (event) => event.status === AgentJobStatus.FAILED && event.result,
  );
  const schema = awaiting ? parseJson(awaiting.inputSchema) : null;
  const result = job.result?.trim() || null;
  return {
    status: job.status,
    input: describeJobInput(job.input, job.inputSchema),
    inputRequest: awaiting
      ? {
          eventId: awaiting.id,
          fields: schemaFields(schema).map(requestField),
          schema,
        }
      : null,
    result: result ? result.slice(0, RESULT_LIMIT) : null,
    resultTruncated: (result?.length ?? 0) > RESULT_LIMIT,
    error:
      job.status === SokosumiJobStatus.FAILED ||
      job.status === SokosumiJobStatus.PAYMENT_FAILED
        ? (failed?.result?.slice(0, 2000) ?? null)
        : null,
    files: job.events.flatMap((event) =>
      event.blobs.flatMap((blob) =>
        blob.status === "READY" && blob.fileUrl
          ? [
              {
                name: blob.name ?? "Output",
                mimeType: blob.mimeType,
                url: blob.fileUrl,
              },
            ]
          : [],
      ),
    ),
    links: job.events.flatMap((event) =>
      event.links.map((link) => ({ title: link.title, url: link.url })),
    ),
  };
}

/**
 * Pure helpers that turn a model-authored decision `proposal` into a safe,
 * bounded, human-readable summary. Nothing here trusts the proposal: keys
 * that look like credentials are masked, depth/size are capped, and the hire
 * proposal is validated before Accept is offered.
 */

const SENSITIVE_KEY_PATTERN =
  /token|password|passwd|secret|api[-_]?key|authorization|payment|card|credential/i;
export const REDACTED_VALUE = "•••";

const MAX_DEPTH = 3;
const MAX_ENTRIES = 12;
const MAX_ARRAY_ITEMS = 5;
const MAX_STRING_LENGTH = 160;

export type RedactedValue =
  | string
  | number
  | boolean
  | null
  | RedactedValue[]
  | { [key: string]: RedactedValue };

function truncate(value: string): string {
  return value.length > MAX_STRING_LENGTH
    ? `${value.slice(0, MAX_STRING_LENGTH - 1)}…`
    : value;
}

/**
 * Recursively mask credential-looking keys and cap depth/breadth so a hostile
 * proposal can neither leak secrets nor blow up the page.
 */
export function redactProposalValue(value: unknown, depth = 0): RedactedValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return truncate(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= MAX_DEPTH) return "…";
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => redactProposalValue(item, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) items.push("…");
    return items;
  }
  if (typeof value === "object") {
    const out: { [key: string]: RedactedValue } = {};
    const entries = Object.entries(value as Record<string, unknown>);
    for (const [key, entry] of entries.slice(0, MAX_ENTRIES)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? REDACTED_VALUE
        : redactProposalValue(entry, depth + 1);
    }
    if (entries.length > MAX_ENTRIES) out["…"] = "…";
    return out;
  }
  return truncate(String(value));
}

/** Compact one-line rendering of a redacted value for definition lists. */
export function formatRedactedValue(value: RedactedValue): string {
  if (value === null) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) return value.map(formatRedactedValue).join(", ");
  return Object.entries(value)
    .map(([key, entry]) => `${key}: ${formatRedactedValue(entry)}`)
    .join(" · ");
}

export type ProposalFieldKey =
  | "agentId"
  | "maxCredits"
  | "name"
  | "projectId"
  | "inputData"
  | "taskId"
  | "coworkerId"
  | "status"
  | "description"
  | "jobId"
  | "eventId"
  | "reason";

export interface ProposalField {
  key: ProposalFieldKey;
  value: string;
  /** Monospace rendering for identifiers. */
  mono?: boolean;
}

export interface ProposalSummary {
  fields: ProposalField[];
  /** Whether Accept may be offered. False for malformed paid proposals. */
  acceptable: boolean;
  /** Ordered fallback: full redacted proposal when no typed fields matched. */
  raw: RedactedValue | null;
}

const FIELD_ORDER: Record<string, ProposalFieldKey[]> = {
  hire_agent: ["agentId", "maxCredits", "name", "projectId", "inputData"],
  provide_job_input: ["jobId", "eventId", "inputData"],
  create_task: ["name", "coworkerId", "status", "projectId", "description"],
  update_task: ["taskId", "name", "status", "description"],
  assign_task: ["taskId", "coworkerId", "status"],
};

const MONO_KEYS = new Set<ProposalFieldKey>([
  "agentId",
  "projectId",
  "taskId",
  "coworkerId",
  "jobId",
  "eventId",
]);

function readPositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** Hire proposals must name an Agent and a positive credit ceiling. */
export function isHireProposalAcceptable(proposal: unknown): boolean {
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
    return false;
  }
  const record = proposal as Record<string, unknown>;
  return (
    readNonEmptyString(record.agentId) !== null &&
    readPositiveNumber(record.maxCredits) !== null
  );
}

/**
 * Build the summary shown next to Accept/Reject. Typed fields for the known
 * tools; a redacted raw dump for anything else, so no proposal is ever hidden.
 */
export function summarizeProposal(
  toolName: string,
  proposal: unknown,
): ProposalSummary {
  const record =
    proposal && typeof proposal === "object" && !Array.isArray(proposal)
      ? (proposal as Record<string, unknown>)
      : null;
  const acceptable =
    toolName === "hire_agent" ? isHireProposalAcceptable(proposal) : true;
  if (!record) {
    return {
      fields: [],
      acceptable,
      raw: proposal === undefined ? null : redactProposalValue(proposal),
    };
  }
  const order = FIELD_ORDER[toolName] ?? [];
  const fields: ProposalField[] = [];
  for (const key of order) {
    if (!(key in record)) continue;
    const redacted = redactProposalValue(
      SENSITIVE_KEY_PATTERN.test(key) ? REDACTED_VALUE : record[key],
    );
    if (redacted === null) continue;
    fields.push({
      key,
      value: formatRedactedValue(redacted),
      mono: MONO_KEYS.has(key),
    });
  }
  const consumed = new Set<string>(order);
  const rest = Object.fromEntries(
    Object.entries(record).filter(([key]) => !consumed.has(key)),
  );
  return {
    fields,
    acceptable,
    raw: Object.keys(rest).length > 0 ? redactProposalValue(rest) : null,
  };
}

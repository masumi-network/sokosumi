import { SOKO_BOT_MEMORY_LIMITS } from "./policy.js";

const SECTION_KEYS = [
  "activeGoals",
  "decisions",
  "preferences",
  "followUps",
  "blockers",
] as const;

const SECTION_TITLES: Record<(typeof SECTION_KEYS)[number], string> = {
  activeGoals: "Active goals",
  decisions: "Decisions",
  preferences: "Preferences",
  followUps: "Follow-ups",
  blockers: "Blockers",
};

export const SOKO_BOT_SENSITIVE_VALUE_PLACEHOLDER = "[Sensitive value removed]";
const CONNECTION_URL_WITH_CREDENTIALS =
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/?#@]+@[^\s/?#]+/i;
const PRIVATE_KEY_MATERIAL = /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/i;
const BEARER_VALUE = /\bbearer\s+([^\s,;]+)/i;
const KNOWN_SECRET_VALUE =
  /\b(?:(?:sk-(?:live-|test-)?|(?:sk|rk|pk)_(?:live|test)_|(?:sk|rk)_restricted_|gh[pousr]_|glpat-|xox[baprs]-)[a-z0-9_-]{12,}|AKIA[A-Z0-9]{16}|AIza[a-z0-9_-]{30,})\b/i;
const JWT_VALUE = /\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/i;
const PAYMENT_IDENTIFIER = /\b(?:pi|pm|tok|src|cus|ch)_[a-z0-9]{12,}\b/i;
const EXPLICIT_SECRET_ASSIGNMENT =
  /\b(?:secret|authorization|api[ _-]?(?:key|token)|access[ _-]?token|refresh[ _-]?token|auth[ _-]?token|token|client[ _-]?secret|private[ _-]?key|password|passwd|pwd|card[ _-]?(?:number|no)|cvv|cvc|payment[ _-]?(?:id|identifier|token))\b["']?\s*[:=]\s*["']?\s*\S+/i;
const DESCRIBED_SECRET_VALUE =
  /\b(?:secret|authorization|api(?:[ _-]+)?(?:key|token)|(?:access|refresh|auth)(?:[ _-]+)?token|token|client(?:[ _-]+)?secret|private(?:[ _-]+)?key|password|passwd|pwd)\b["']?\s*(\bis\b|\bwas\b|\bequals?\b|\bvalue\s+is\b)\s*(["']?)\s*(\S+)/gi;
const BENIGN_SECRET_GOVERNANCE_PREDICATES = new Set([
  "changed",
  "disabled",
  "enabled",
  "expired",
  "generated",
  "managed",
  "required",
  "reset",
  "revoked",
  "rotated",
  "stored",
  "updated",
]);
const PREFIXED_SNAKE_SECRET_ASSIGNMENT =
  /\b(?:[a-z0-9]+_)+(?:password|passwd|pwd|secret_access_key|secret_key|secret|api_key|api_token|access_token|refresh_token|auth_token|private_key)\s*[:=]\s*\S+/i;
const PREFIXED_CAMEL_SECRET_ASSIGNMENT =
  /\b[a-z][a-z0-9]*(?:Password|Passwd|Pwd|SecretAccessKey|SecretKey|Secret|ApiKey|ApiToken|AccessToken|RefreshToken|AuthToken|PrivateKey)\s*[:=]\s*\S+/i;
const SEPARATORLESS_SECRET_VALUE =
  /\b(?:api(?:[ _-]+)?(?:key|token)|(?:access|refresh|auth)(?:[ _-]+)?token|password|passwd|pwd|private(?:[ _-]+)?key|client(?:[ _-]+)?secret|secret|token|authorization)\b\s+(\S+)/gi;
const STANDALONE_LABELED_SECRET_VALUE =
  /\b(?:api(?:[ _-]+)?(?:key|token)|(?:access|refresh|auth)(?:[ _-]+)?token|password|passwd|pwd|private(?:[ _-]+)?key|client(?:[ _-]+)?secret|secret|token|authorization)\b\s+(\S+)\s*$/i;
const TERSE_GOVERNANCE_LABEL_AND_TOPIC =
  /^(password|token|api key|private key|client secret)\s+(\S+)$/i;
type TerseGovernanceLabel =
  | "password"
  | "token"
  | "api key"
  | "private key"
  | "client secret";
const TERSE_GOVERNANCE_TOPICS: Record<
  TerseGovernanceLabel,
  ReadonlySet<string>
> = {
  password: new Set(["must", "policy", "requirements", "reset"]),
  token: new Set(["refresh", "rotation"]),
  "api key": new Set(["ownership", "rotation"]),
  "private key": new Set(["custody", "generation"]),
  "client secret": new Set(["access", "governance"]),
};
const COMMON_WEAK_SECRET_VALUES = new Set([
  "abcdef",
  "changeme",
  "huntertwo",
  "letmein",
  "password",
  "qwerty",
  "secret",
  "swordfish",
]);
const PAYMENT_SECURITY_CODE = /\b(?:cvv|cvc)\b\s*[:=]?\s*\d{3,4}\b/i;
const CARD_NUMBER_CANDIDATE = /(?:\d[ -]?){13,19}/g;

export interface SokoBotMemory {
  activeGoals: string[];
  decisions: string[];
  preferences: string[];
  followUps: string[];
  blockers: string[];
}

export interface ParseSokoBotMemoryOptions {
  secretHandling?: "redact" | "reject";
}

export class SokoBotMemorySecretError extends Error {
  constructor() {
    super("Soko Bot memory contains credentials or payment secrets");
    this.name = "SokoBotMemorySecretError";
  }
}

export function createEmptySokoBotMemory(): SokoBotMemory {
  return {
    activeGoals: [],
    decisions: [],
    preferences: [],
    followUps: [],
    blockers: [],
  };
}

function isValidCardNumber(value: string): boolean {
  const digits = value.replaceAll(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

function containsCardNumber(value: string): boolean {
  return [...value.matchAll(CARD_NUMBER_CANDIDATE)].some((match) =>
    isValidCardNumber(match[0]),
  );
}

function containsBearerCredential(value: string): boolean {
  const candidate = value.match(BEARER_VALUE)?.[1]?.replace(/[.)\]}]+$/, "");
  if (!candidate) return false;
  return !["authentication", "credentials", "scheme", "token"].includes(
    candidate.toLowerCase(),
  );
}

function looksLikeCredentialValue(value: string): boolean {
  const candidate = /^[a-z]+\.$/i.test(value) ? value.slice(0, -1) : value;
  if (COMMON_WEAK_SECRET_VALUES.has(candidate.toLowerCase())) return true;
  return /[^a-z]/i.test(candidate) || candidate.length >= 24;
}

function containsMatchedCredentialValue(
  value: string,
  pattern: RegExp,
): boolean {
  return [...value.matchAll(pattern)].some((match) => {
    const candidate = match[1];
    return Boolean(candidate && looksLikeCredentialValue(candidate));
  });
}

function containsDescribedSecretAssignment(value: string): boolean {
  return [...value.matchAll(DESCRIBED_SECRET_VALUE)].some((match) => {
    const operator = match[1]?.toLowerCase().replaceAll(/\s+/g, " ");
    const openingQuote = match[2];
    const candidate = match[3];
    if (!operator || !candidate || openingQuote) return true;
    if (
      operator === "equal" ||
      operator === "equals" ||
      operator === "value is"
    ) {
      return true;
    }
    return !BENIGN_SECRET_GOVERNANCE_PREDICATES.has(candidate.toLowerCase());
  });
}

function containsPrefixedSecretAssignment(value: string): boolean {
  return (
    PREFIXED_SNAKE_SECRET_ASSIGNMENT.test(value) ||
    PREFIXED_CAMEL_SECRET_ASSIGNMENT.test(value)
  );
}

function toTerseGovernanceLabel(value: string): TerseGovernanceLabel | null {
  const normalized = value.toLowerCase();
  switch (normalized) {
    case "password":
    case "token":
    case "api key":
    case "private key":
    case "client secret":
      return normalized;
    default:
      return null;
  }
}

function isBenignTerseGovernance(value: string): boolean {
  const match = TERSE_GOVERNANCE_LABEL_AND_TOPIC.exec(value.trim());
  const label = match?.[1] ? toTerseGovernanceLabel(match[1]) : null;
  const rawTopic = match?.[2];
  if (!label || !rawTopic) return false;

  const topic = rawTopic.endsWith(".") ? rawTopic.slice(0, -1) : rawTopic;
  return TERSE_GOVERNANCE_TOPICS[label].has(topic.toLowerCase());
}

function containsStandaloneLabeledSecretValue(value: string): boolean {
  if (isBenignTerseGovernance(value)) return false;

  const match = STANDALONE_LABELED_SECRET_VALUE.exec(value);
  const candidate = match?.[1];
  if (!candidate || match.index === undefined) return false;

  // Entry/clause boundaries make a single trailing word an explicit value,
  // while leaving mid-sentence credential-governance mentions as prose.
  const prefix = value.slice(0, match.index).trimEnd();
  const beginsEntryOrClause =
    prefix.length === 0 || /[:;([{\-–—]$/.test(prefix);
  return beginsEntryOrClause;
}

export function containsSokoBotSensitiveMaterial(value: string): boolean {
  return (
    CONNECTION_URL_WITH_CREDENTIALS.test(value) ||
    PRIVATE_KEY_MATERIAL.test(value) ||
    containsBearerCredential(value) ||
    KNOWN_SECRET_VALUE.test(value) ||
    JWT_VALUE.test(value) ||
    PAYMENT_IDENTIFIER.test(value) ||
    EXPLICIT_SECRET_ASSIGNMENT.test(value) ||
    containsPrefixedSecretAssignment(value) ||
    containsDescribedSecretAssignment(value) ||
    containsStandaloneLabeledSecretValue(value) ||
    containsMatchedCredentialValue(value, SEPARATORLESS_SECRET_VALUE) ||
    PAYMENT_SECURITY_CODE.test(value) ||
    containsCardNumber(value)
  );
}

/**
 * Removes an entire untrusted value when it contains credential or payment
 * material. Whole-value replacement avoids leaking fragments around unusual
 * separators and keeps every Core/runtime presentation boundary consistent.
 */
export function redactSokoBotSensitiveText(value: string): string {
  return containsSokoBotSensitiveMaterial(value)
    ? SOKO_BOT_SENSITIVE_VALUE_PLACEHOLDER
    : value;
}

function normalizeEntries(
  entries: readonly string[],
  secretHandling: "redact" | "reject",
): string[] {
  return entries
    .map((entry) => entry.replaceAll(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((entry) => {
      if (containsSokoBotSensitiveMaterial(entry)) {
        if (secretHandling === "reject") {
          throw new SokoBotMemorySecretError();
        }
        return SOKO_BOT_SENSITIVE_VALUE_PLACEHOLDER;
      }
      return entry.slice(0, SOKO_BOT_MEMORY_LIMITS.maxEntryLength);
    })
    .slice(0, SOKO_BOT_MEMORY_LIMITS.maxEntriesPerSection);
}

export function renderSokoBotMemory(memory: SokoBotMemory): string {
  const sections = SECTION_KEYS.map((key) => {
    const entries = normalizeEntries(memory[key], "redact");
    const body =
      entries.length > 0 ? entries.map((entry) => `- ${entry}`) : ["- None"];
    return [`## ${SECTION_TITLES[key]}`, ...body].join("\n");
  });
  const markdown = ["# Soko Bot memory", ...sections, ""].join("\n\n");

  if (Buffer.byteLength(markdown, "utf8") > SOKO_BOT_MEMORY_LIMITS.maxBytes) {
    throw new Error("Soko Bot memory exceeds byte limit");
  }
  return markdown;
}

export function parseSokoBotMemory(
  markdown: string,
  options: ParseSokoBotMemoryOptions = {},
): SokoBotMemory {
  if (Buffer.byteLength(markdown, "utf8") > SOKO_BOT_MEMORY_LIMITS.maxBytes) {
    throw new Error("Soko Bot memory exceeds byte limit");
  }

  const memory = createEmptySokoBotMemory();
  const titleToKey = new Map(
    SECTION_KEYS.map(
      (key) => [SECTION_TITLES[key].toLowerCase(), key] as const,
    ),
  );
  let currentKey: (typeof SECTION_KEYS)[number] | null = null;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("## ")) {
      currentKey = titleToKey.get(line.slice(3).trim().toLowerCase()) ?? null;
      continue;
    }
    if (currentKey && line.startsWith("- ") && line !== "- None") {
      memory[currentKey].push(line.slice(2));
    }
  }

  const secretHandling = options.secretHandling ?? "redact";
  for (const key of SECTION_KEYS) {
    memory[key] = normalizeEntries(memory[key], secretHandling);
  }
  return memory;
}

/** Canonical safe rendering for any persisted or legacy memory value. */
export function sanitizeSokoBotMemoryMarkdown(markdown: string): string {
  try {
    return renderSokoBotMemory(
      parseSokoBotMemory(markdown, { secretHandling: "redact" }),
    );
  } catch {
    return renderSokoBotMemory(createEmptySokoBotMemory());
  }
}

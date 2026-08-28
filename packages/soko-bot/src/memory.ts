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
const BEARER_LABEL = /\bbearer\b/gi;
const BEARER_GOVERNANCE_VALUES = new Set([
  "authentication",
  "credentials",
  "scheme",
  "token",
]);
const KNOWN_SECRET_VALUE =
  /\b(?:(?:sk-(?:live-|test-)?|(?:sk|rk|pk)_(?:live|test)_|(?:sk|rk)_restricted_|gh[pousr]_|glpat-|xox[baprs]-)[a-z0-9_-]{12,}|AKIA[A-Z0-9]{16}|AIza[a-z0-9_-]{30,})\b/i;
const JWT_VALUE = /\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/i;
const PAYMENT_IDENTIFIER = /\b(?:pi|pm|tok|src|cus|ch)_[a-z0-9]{12,}\b/i;
const CREDENTIAL_LABEL =
  /\b(?:api[ _-]*(?:key|token)|(?:access|refresh|auth)[ _-]*token|client[ _-]*secret|private[ _-]*key|password|passwd|pwd|authorization|secret|token)\b/gi;
const EXPLICIT_SECRET_LABEL =
  /\b(?:api[ _-]*(?:key|token)|(?:access|refresh|auth)[ _-]*token|client[ _-]*secret|private[ _-]*key|card[ _-]*(?:number|no)|payment[ _-]*(?:id|identifier|token)|password|passwd|pwd|authorization|secret|token|cvv|cvc)\b/gi;
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
const PAYMENT_SECURITY_CODE_LABEL = /\b(?:cvv|cvc)\b/gi;
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

/**
 * A card number stands on its own; a digit run sitting inside a longer
 * alphanumeric token is an identifier, not a card. UUIDs are the common case:
 * `01a03f23-0fd8-72c5-9572-30751931fe0b` contains the 13-digit dash-separated
 * run `5-9572-30751931`, which passes Luhn. Treating that as a card blanked
 * event ids out of admin payloads and task ids out of the bot's own answers.
 */
function containsCardNumber(value: string): boolean {
  for (const match of value.matchAll(CARD_NUMBER_CANDIDATE)) {
    // The pattern can swallow a trailing separator, which would push the
    // boundary check onto the following word. Trimmed by index rather than by
    // an anchored regex: `/[ -]+$/` backtracks from every start position, which
    // is quadratic on a long run of spaces (CodeQL js/polynomial-redos).
    let end = match[0].length;
    while (end > 0) {
      const character = match[0][end - 1];
      if (character !== " " && character !== "-") break;
      end -= 1;
    }
    const candidate = match[0].slice(0, end);
    const start = match.index ?? 0;
    const before = value[start - 1];
    const after = value[start + candidate.length];
    if (isAsciiLetter(before) || isAsciiLetter(after)) continue;
    if (isValidCardNumber(candidate)) return true;
  }
  return false;
}

function skipWhitespace(value: string, start: number): number {
  let cursor = start;
  while (cursor < value.length && value[cursor]?.trim() === "") cursor += 1;
  return cursor;
}

function readNonWhitespaceToken(
  value: string,
  start: number,
): { end: number; value: string } | null {
  if (start >= value.length || value[start]?.trim() === "") return null;
  let end = start + 1;
  while (end < value.length && value[end]?.trim() !== "") end += 1;
  return { end, value: value.slice(start, end) };
}

function isAsciiLetter(value: string | undefined): boolean {
  if (!value) return false;
  const code = value.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isAsciiWordCharacter(value: string | undefined): boolean {
  if (!value) return false;
  const code = value.charCodeAt(0);
  return isAsciiLetter(value) || (code >= 48 && code <= 57) || value === "_";
}

function readAsciiWord(
  value: string,
  start: number,
): { end: number; value: string } | null {
  if (!isAsciiLetter(value[start])) return null;
  let end = start + 1;
  while (isAsciiLetter(value[end])) end += 1;
  return { end, value: value.slice(start, end).toLowerCase() };
}

function secretLabelMatches(value: string): IterableIterator<RegExpMatchArray> {
  return value.matchAll(CREDENTIAL_LABEL);
}

function containsBearerCredential(value: string): boolean {
  for (const match of value.matchAll(BEARER_LABEL)) {
    const labelEnd = (match.index ?? 0) + match[0].length;
    let cursor = skipWhitespace(value, labelEnd);
    if (cursor === labelEnd) continue;
    const candidateStart = cursor;
    while (
      cursor < value.length &&
      value[cursor]?.trim() !== "" &&
      value[cursor] !== "," &&
      value[cursor] !== ";"
    ) {
      cursor += 1;
    }
    while (
      cursor > candidateStart &&
      ".)]}".includes(value[cursor - 1] ?? "")
    ) {
      cursor -= 1;
    }
    if (cursor === candidateStart) continue;
    const candidate = value.slice(candidateStart, cursor).toLowerCase();
    if (!BEARER_GOVERNANCE_VALUES.has(candidate)) return true;
  }
  return false;
}

function looksLikeCredentialValue(value: string): boolean {
  const candidate = /^[a-z]+\.$/i.test(value) ? value.slice(0, -1) : value;
  if (COMMON_WEAK_SECRET_VALUES.has(candidate.toLowerCase())) return true;
  return /[^a-z]/i.test(candidate) || candidate.length >= 24;
}

function containsSeparatorlessCredentialValue(value: string): boolean {
  for (const match of secretLabelMatches(value)) {
    const labelEnd = (match.index ?? 0) + match[0].length;
    const candidateStart = skipWhitespace(value, labelEnd);
    if (candidateStart === labelEnd) continue;
    const candidate = readNonWhitespaceToken(value, candidateStart)?.value;
    if (candidate && looksLikeCredentialValue(candidate)) return true;
  }
  return false;
}

function containsDescribedSecretAssignment(value: string): boolean {
  for (const match of secretLabelMatches(value)) {
    let cursor = (match.index ?? 0) + match[0].length;
    if (value[cursor] === '"' || value[cursor] === "'") cursor += 1;
    cursor = skipWhitespace(value, cursor);

    const firstWord = readAsciiWord(value, cursor);
    if (!firstWord) continue;
    cursor = firstWord.end;
    let operator = firstWord.value;
    if (operator === "value") {
      const secondWordStart = skipWhitespace(value, cursor);
      if (secondWordStart === cursor) continue;
      const secondWord = readAsciiWord(value, secondWordStart);
      if (!secondWord || secondWord.value !== "is") continue;
      operator = "value is";
      cursor = secondWord.end;
    } else if (!["equal", "equals", "is", "was"].includes(operator)) {
      continue;
    }
    if (isAsciiWordCharacter(value[cursor])) continue;

    cursor = skipWhitespace(value, cursor);
    const openingQuote = value[cursor] === '"' || value[cursor] === "'";
    if (openingQuote) cursor = skipWhitespace(value, cursor + 1);
    const candidate = readNonWhitespaceToken(value, cursor)?.value;
    if (!candidate) continue;
    if (openingQuote) return true;
    if (
      operator === "equal" ||
      operator === "equals" ||
      operator === "value is"
    ) {
      return true;
    }
    if (!BENIGN_SECRET_GOVERNANCE_PREDICATES.has(candidate.toLowerCase())) {
      return true;
    }
  }
  return false;
}

function containsExplicitSecretAssignment(value: string): boolean {
  for (const match of value.matchAll(EXPLICIT_SECRET_LABEL)) {
    let cursor = (match.index ?? 0) + match[0].length;
    if (value[cursor] === '"' || value[cursor] === "'") cursor += 1;
    cursor = skipWhitespace(value, cursor);
    if (value[cursor] !== ":" && value[cursor] !== "=") continue;
    cursor = skipWhitespace(value, cursor + 1);
    if (value[cursor] === '"' || value[cursor] === "'") {
      cursor = skipWhitespace(value, cursor + 1);
    }
    if (readNonWhitespaceToken(value, cursor)) return true;
  }
  return false;
}

function containsPaymentSecurityCode(value: string): boolean {
  for (const match of value.matchAll(PAYMENT_SECURITY_CODE_LABEL)) {
    let cursor = skipWhitespace(value, (match.index ?? 0) + match[0].length);
    if (value[cursor] === ":" || value[cursor] === "=") {
      cursor = skipWhitespace(value, cursor + 1);
    }
    const digitStart = cursor;
    while (cursor < value.length) {
      const code = value.charCodeAt(cursor);
      if (code < 48 || code > 57) break;
      cursor += 1;
    }
    const digitCount = cursor - digitStart;
    if (
      (digitCount === 3 || digitCount === 4) &&
      !isAsciiWordCharacter(value[cursor])
    ) {
      return true;
    }
  }
  return false;
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

  for (const match of secretLabelMatches(value)) {
    const matchIndex = match.index ?? 0;
    const labelEnd = matchIndex + match[0].length;
    const candidateStart = skipWhitespace(value, labelEnd);
    if (candidateStart === labelEnd) continue;
    const candidate = readNonWhitespaceToken(value, candidateStart);
    if (!candidate || skipWhitespace(value, candidate.end) !== value.length) {
      continue;
    }

    // Entry/clause boundaries make a single trailing word an explicit value,
    // while leaving mid-sentence credential-governance mentions as prose.
    const prefix = value.slice(0, matchIndex).trimEnd();
    const beginsEntryOrClause =
      prefix.length === 0 || /[:;([{\-–—]$/.test(prefix);
    if (beginsEntryOrClause) return true;
  }
  return false;
}

export function containsSokoBotSensitiveMaterial(value: string): boolean {
  return (
    CONNECTION_URL_WITH_CREDENTIALS.test(value) ||
    PRIVATE_KEY_MATERIAL.test(value) ||
    containsBearerCredential(value) ||
    KNOWN_SECRET_VALUE.test(value) ||
    JWT_VALUE.test(value) ||
    PAYMENT_IDENTIFIER.test(value) ||
    containsExplicitSecretAssignment(value) ||
    containsPrefixedSecretAssignment(value) ||
    containsDescribedSecretAssignment(value) ||
    containsStandaloneLabeledSecretValue(value) ||
    containsSeparatorlessCredentialValue(value) ||
    containsPaymentSecurityCode(value) ||
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

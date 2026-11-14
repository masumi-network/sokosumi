import {
  containsSokoBotSensitiveMaterial,
  redactSokoBotSensitiveText,
} from "./memory.js";
import type { RuntimeJsonValue } from "./runtime.js";

export const SOKO_BOT_WEB_EVIDENCE_FORMAT = "soko-web-evidence-v1";
export const SOKO_BOT_WEB_EVIDENCE_MAX_BYTES = 8_000;
const SOURCE_BYTES = 1_024;
const MAX_DEPTH = 8;
const MAX_ITEMS = 100;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function wellFormed(value: string): string {
  return decoder.decode(encoder.encode(value));
}

export interface SokoBotWebEvidence {
  data: RuntimeJsonValue;
  sources: string[];
  evidence: {
    format: typeof SOKO_BOT_WEB_EVIDENCE_FORMAT;
    redacted: boolean;
    truncated: boolean;
  };
}

export function isSokoBotWebEvidence(
  value: unknown,
): value is SokoBotWebEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const evidence = candidate.evidence;
  return Boolean(
    evidence &&
      typeof evidence === "object" &&
      "format" in evidence &&
      evidence.format === SOKO_BOT_WEB_EVIDENCE_FORMAT &&
      "redacted" in evidence &&
      typeof evidence.redacted === "boolean" &&
      "truncated" in evidence &&
      typeof evidence.truncated === "boolean" &&
      "data" in candidate &&
      Array.isArray(candidate.sources) &&
      candidate.sources.every((source) => typeof source === "string"),
  );
}

/** The bot and its audit receive this same bounded, secret-safe web view. */
export function projectSokoBotWebEvidence(
  value: unknown,
  sourceUrls: readonly string[] = [],
): SokoBotWebEvidence {
  const previous = isSokoBotWebEvidence(value) ? value : null;
  let redacted = previous?.evidence.redacted ?? false;
  let truncated = previous?.evidence.truncated ?? false;
  const seen = new WeakSet<object>();
  function text(value: string): string {
    const safe = redactSokoBotSensitiveText(
      wellFormed(value.replaceAll("\u0000", "")),
    );
    redacted ||= safe !== value;
    return safe;
  }
  function safe(value: unknown, depth = 0): RuntimeJsonValue {
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") return text(value);
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "object") return text(String(value));
    if (depth >= MAX_DEPTH || seen.has(value)) {
      truncated = true;
      return "[Truncated]";
    }
    seen.add(value);
    if (Array.isArray(value)) {
      truncated ||= value.length > MAX_ITEMS;
      return value.slice(0, MAX_ITEMS).map((item) => safe(item, depth + 1));
    }
    const entries = Object.entries(value);
    truncated ||= entries.length > MAX_ITEMS;
    return Object.fromEntries(
      entries
        .slice(0, MAX_ITEMS)
        .map(([key, item]) => [
          text(key),
          containsSokoBotSensitiveMaterial(`${key}: value`)
            ? text(`${key}: value`)
            : safe(item, depth + 1),
        ]),
    );
  }
  const data = safe(previous ? previous.data : value);
  const sources: string[] = [];
  let sourceBytes = 0;
  for (const url of new Set(previous?.sources ?? sourceUrls)) {
    if (containsSokoBotSensitiveMaterial(url)) {
      redacted = true;
      continue;
    }
    const safeUrl = text(url);
    if (!URL.canParse(safeUrl) || !/^https?:$/.test(new URL(safeUrl).protocol))
      continue;
    sourceBytes += encoder.encode(JSON.stringify(safeUrl)).byteLength + 1;
    if (sourceBytes > SOURCE_BYTES) {
      truncated = true;
      break;
    }
    sources.push(safeUrl);
  }
  const view = (data: RuntimeJsonValue): SokoBotWebEvidence => ({
    data,
    sources,
    evidence: { format: SOKO_BOT_WEB_EVIDENCE_FORMAT, redacted, truncated },
  });
  if (
    encoder.encode(JSON.stringify(view(data))).byteLength <=
    SOKO_BOT_WEB_EVIDENCE_MAX_BYTES
  )
    return view(data);
  truncated = true;
  const serialized = JSON.stringify(data);
  let low = 0;
  let high = serialized.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = view({
      preview: wellFormed(serialized.slice(0, middle)),
    });
    if (
      encoder.encode(JSON.stringify(candidate)).byteLength <=
      SOKO_BOT_WEB_EVIDENCE_MAX_BYTES
    )
      low = middle;
    else high = middle - 1;
  }
  return view({ preview: text(wellFormed(serialized.slice(0, low))) });
}

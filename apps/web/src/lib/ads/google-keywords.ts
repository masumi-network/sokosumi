import type { GoogleKeyword } from "@sokosumi/core-client";
import {
  GoogleKeywordSchema,
  GoogleSearchCampaignSpecSchema,
} from "@sokosumi/core-client/schemas";

/** Core's limits for Search keywords: how many, how long and how many words. */
export const GOOGLE_KEYWORD_LIMIT =
  GoogleSearchCampaignSpecSchema.properties.keywords.maxItems;
export const GOOGLE_KEYWORD_MAX_LENGTH =
  GoogleKeywordSchema.properties.text.maxLength;
export const GOOGLE_KEYWORD_MAX_WORDS = 10;
export const GOOGLE_MATCH_TYPES = GoogleKeywordSchema.properties.matchType.enum;

export type GoogleKeywordIssue = "syntax" | "tooLong" | "tooManyWords";

export interface InvalidKeywordLine {
  /** 1-based, counting blank lines. */
  line: number;
  text: string;
  issue: GoogleKeywordIssue;
}

export interface ParsedKeywords {
  /** Valid keywords, repeats (same text ignoring case, same match type) dropped. */
  keywords: GoogleKeyword[];
  invalid: InvalidKeywordLine[];
}

type Parsed = GoogleKeyword | GoogleKeywordIssue;

function parseLine(line: string): Parsed {
  let matchType: GoogleKeyword["matchType"] = "BROAD";
  let body = line;
  if (line.startsWith('"') && line.endsWith('"') && line.length >= 2) {
    matchType = "PHRASE";
    body = line.slice(1, -1);
  } else if (line.startsWith("[") && line.endsWith("]")) {
    matchType = "EXACT";
    body = line.slice(1, -1);
  }

  const text = body.trim().replace(/\s+/g, " ");
  // Whatever delimiter is left over is unbalanced or misplaced.
  if (text === "" || /["[\]]/.test(text)) return "syntax";
  if (text.length > GOOGLE_KEYWORD_MAX_LENGTH) return "tooLong";
  if (text.split(" ").length > GOOGLE_KEYWORD_MAX_WORDS) return "tooManyWords";
  return { text, matchType };
}

/**
 * Google's keyword syntax, one keyword per line: `shoes` is broad, `"shoes"`
 * phrase and `[shoes]` exact. Blank lines are dropped, inner spaces collapse,
 * and a line that breaks Core's rules is reported with its number instead of
 * being fixed.
 */
export function parseGoogleKeywords(input: string): ParsedKeywords {
  const keywords: GoogleKeyword[] = [];
  const invalid: InvalidKeywordLine[] = [];
  const seen = new Set<string>();

  input.split(/\r?\n/).forEach((raw, index) => {
    const text = raw.trim();
    if (text === "") return;
    const parsed = parseLine(text);
    if (typeof parsed === "string") {
      invalid.push({ line: index + 1, text, issue: parsed });
      return;
    }
    const key = `${parsed.matchType}:${parsed.text.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    keywords.push(parsed);
  });

  return { keywords, invalid };
}

/** A keyword in Google's syntax: `shoes`, `"shoes"` or `[shoes]`. */
export function formatGoogleKeyword({
  text,
  matchType,
}: GoogleKeyword): string {
  if (matchType === "PHRASE") return `"${text}"`;
  return matchType === "EXACT" ? `[${text}]` : text;
}

/**
 * Appends keywords as broad lines to the textarea's text, skipping any whose
 * text is already there (in any match type) and anything past the limit or
 * that Core would refuse. The existing text is kept as typed.
 */
export function appendBroadKeywords(
  current: string,
  additions: readonly string[],
): { text: string; added: number } {
  const { keywords } = parseGoogleKeywords(current);
  const known = new Set(keywords.map(({ text }) => text.toLowerCase()));
  const lines: string[] = [];

  for (const addition of additions) {
    if (keywords.length + lines.length >= GOOGLE_KEYWORD_LIMIT) break;
    const parsed = parseLine(addition.trim());
    if (
      typeof parsed === "string" ||
      parsed.matchType !== "BROAD" ||
      known.has(parsed.text.toLowerCase())
    ) {
      continue;
    }
    known.add(parsed.text.toLowerCase());
    lines.push(parsed.text);
  }

  if (lines.length === 0) return { text: current, added: 0 };
  const base = current.trimEnd();
  return {
    text: `${base}${base ? "\n" : ""}${lines.join("\n")}\n`,
    added: lines.length,
  };
}

import { escapeMarkdownLinkUrl } from "./markdown-links.js";
import {
  collectMarkdownLinkRanges,
  escapeMarkdownLinkLabel,
  isFenceChar,
  rangeContaining,
  skipFencedCode,
  skipInlineCode,
} from "./markdown-prose-scan.js";

const TRAILING_PUNCTUATION = new Set([
  ".",
  ",",
  ";",
  ":",
  "!",
  "?",
  ")",
  "}",
  "]",
]);

/**
 * Known multi-letter TLDs (ASCII). Match is allowlist-only — unknown labels
 * (including arbitrary 3+ letter tokens like `foo.bar`) stay plain text.
 */
const TLD_ALLOWLIST = new Set([
  // Common gTLDs / new gTLDs
  "com",
  "org",
  "net",
  "edu",
  "gov",
  "mil",
  "int",
  "info",
  "biz",
  "name",
  "pro",
  "app",
  "dev",
  "io",
  "ai",
  "co",
  "me",
  "tv",
  "cc",
  "fm",
  "ly",
  "to",
  "gg",
  "xyz",
  "online",
  "site",
  "tech",
  "store",
  "blog",
  "cloud",
  "shop",
  "club",
  "page",
  "web",
  "new",
  "one",
  "world",
  "digital",
  "media",
  "agency",
  "studio",
  "design",
  "tools",
  "systems",
  "solutions",
  "company",
  "email",
  "news",
  "today",
  "space",
  "live",
  "life",
  "games",
  "game",
  "video",
  "music",
  "photo",
  "photos",
  "gallery",
  "center",
  "global",
  "international",
  "network",
  "software",
  "technology",
  "services",
  // Country / region (frequent + user examples)
  "de",
  "uk",
  "us",
  "eu",
  "fr",
  "es",
  "it",
  "nl",
  "be",
  "at",
  "ch",
  "pl",
  "cz",
  "se",
  "no",
  "dk",
  "fi",
  "ie",
  "pt",
  "br",
  "mx",
  "ar",
  "cl",
  "jp",
  "cn",
  "kr",
  "in",
  "au",
  "nz",
  "za",
  "ca",
  "ru",
  "ua",
  "tr",
  "il",
  "sg",
  "hk",
  "tw",
  "id",
  "th",
  "vn",
  "ph",
  "my",
  "ae",
]);

/**
 * Path-less hostnames ending in these labels look like filenames, not sites.
 * Blocks e.g. `report.pdf` even if a label were ever allowlisted.
 */
const FILE_EXTENSION_DENYLIST = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
  "txt",
  "csv",
  "tsv",
  "md",
  "markdown",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "zip",
  "rar",
  "7z",
  "gz",
  "tar",
  "bz2",
  "mp3",
  "mp4",
  "mov",
  "avi",
  "mkv",
  "webm",
  "wav",
  "ogg",
  "flac",
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "json",
  "xml",
  "yml",
  "yaml",
  "toml",
  "css",
  "scss",
  "less",
  "html",
  "htm",
  "map",
  "wasm",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "swift",
  "c",
  "h",
  "cpp",
  "hpp",
  "cs",
  "php",
  "sh",
  "bash",
  "zsh",
  "sql",
  "db",
  "sqlite",
  "log",
  "lock",
  "env",
  "ini",
  "cfg",
  "conf",
  "exe",
  "dll",
  "so",
  "dylib",
  "bin",
  "dmg",
  "pkg",
  "deb",
  "rpm",
  "apk",
  "ipa",
]);

function isAsciiLetter(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isAsciiDigit(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function isLabelChar(ch: string): boolean {
  return isAsciiLetter(ch) || isAsciiDigit(ch) || ch === "-";
}

function isHostChar(ch: string): boolean {
  return isLabelChar(ch) || ch === ".";
}

function isStopChar(ch: string): boolean {
  return (
    ch === " " ||
    ch === "\t" ||
    ch === "\n" ||
    ch === "\r" ||
    ch === "<" ||
    ch === ">" ||
    ch === "[" ||
    ch === "]" ||
    ch === "`" ||
    ch === "'" ||
    ch === '"' ||
    ch === "(" ||
    ch === ")"
  );
}

function isDomainBoundaryBefore(text: string, index: number): boolean {
  if (index <= 0) return true;
  const prev = text[index - 1]!;
  if (prev === "@") return false;
  if (isHostChar(prev) || prev === "/" || prev === ":" || prev === "_") {
    return false;
  }
  return true;
}

function stripTrailingPunctuation(raw: string): string {
  let end = raw.length;
  while (end > 0 && TRAILING_PUNCTUATION.has(raw[end - 1]!)) {
    end -= 1;
  }
  return end === raw.length ? raw : raw.slice(0, end);
}

function isValidHostLabel(label: string): boolean {
  if (label.length === 0 || label.length > 63) return false;
  if (label.startsWith("-") || label.endsWith("-")) return false;
  for (let i = 0; i < label.length; i += 1) {
    if (!isLabelChar(label[i]!)) return false;
  }
  return true;
}

function isAllowedTld(tld: string): boolean {
  if (tld.length < 2 || tld.length > 63) return false;
  for (let i = 0; i < tld.length; i += 1) {
    if (!isAsciiLetter(tld[i]!)) return false;
  }
  return TLD_ALLOWLIST.has(tld.toLowerCase());
}

function labelHasLetter(label: string): boolean {
  for (let i = 0; i < label.length; i += 1) {
    if (isAsciiLetter(label[i]!)) return true;
  }
  return false;
}

function hostLooksLikeIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (part.length === 0 || part.length > 3) return false;
    for (let i = 0; i < part.length; i += 1) {
      if (!isAsciiDigit(part[i]!)) return false;
    }
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

/** True when there is no URL path (empty, or only query/fragment). */
function isPathlessRest(rest: string): boolean {
  return rest.length === 0 || rest.startsWith("?") || rest.startsWith("#");
}

function isEligibleBareDomainMatch(match: string): boolean {
  let hostEnd = match.length;
  for (let i = 0; i < match.length; i += 1) {
    const ch = match[i]!;
    if (ch === "/" || ch === "?" || ch === "#") {
      hostEnd = i;
      break;
    }
  }
  const host = match.slice(0, hostEnd);
  const rest = match.slice(hostEnd);

  if (host.length === 0) return false;
  if (host.includes(":") || host.includes("@")) return false;
  if (host.toLowerCase() === "localhost") return false;
  if (host.toLowerCase().endsWith(".localhost")) return false;
  if (hostLooksLikeIpv4(host)) return false;
  if (host.toLowerCase().startsWith("www.")) return false;

  const labels = host.split(".");
  if (labels.length < 2) return false;

  for (const label of labels) {
    if (!isValidHostLabel(label)) return false;
  }

  const tld = labels[labels.length - 1]!;
  const tldLower = tld.toLowerCase();

  if (isPathlessRest(rest) && FILE_EXTENSION_DENYLIST.has(tldLower)) {
    return false;
  }

  if (!isAllowedTld(tld)) return false;

  const nameLabels = labels.slice(0, -1);
  if (!nameLabels.some(labelHasLetter)) {
    return false;
  }

  const href = `https://${match}`;
  try {
    const parsed = new URL(href);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false;
    }
    if (!parsed.hostname) return false;
  } catch {
    return false;
  }

  return true;
}

function tryMatchBareDomain(
  text: string,
  start: number,
): { match: string; end: number } | null {
  if (!isDomainBoundaryBefore(text, start)) return null;

  const first = text[start];
  if (!first || !(isAsciiLetter(first) || isAsciiDigit(first))) return null;

  let i = start;
  while (i < text.length && isHostChar(text[i]!)) {
    i += 1;
  }

  if (i < text.length) {
    const next = text[i]!;
    if (next === "/" || next === "?" || next === "#") {
      while (i < text.length && !isStopChar(text[i]!)) {
        const ch = text[i]!;
        if (ch === "[" || ch === "]" || ch === "<" || ch === ">") break;
        i += 1;
      }
    }
  }

  const raw = text.slice(start, i);
  if (!raw.includes(".")) return null;

  const stripped = stripTrailingPunctuation(raw);
  if (stripped.length === 0 || !stripped.includes(".")) return null;

  if (!isEligibleBareDomainMatch(stripped)) return null;

  return { match: stripped, end: start + stripped.length };
}

function skipSchemeUrl(text: string, start: number): number {
  let i = start;
  while (i < text.length && !isStopChar(text[i]!)) {
    i += 1;
  }
  let end = i;
  while (end > start && TRAILING_PUNCTUATION.has(text[end - 1]!)) {
    end -= 1;
  }
  return Math.max(end, start + 1);
}

/**
 * Display-time helper: rewrite plain bare domains in markdown prose into
 * `[host…](https://host…)` links. Skips code, existing links, scheme URLs,
 * `www.` hosts (GFM), emails, IPs, and localhost. Does not mutate stored bodies —
 * callers apply this only on render.
 */
export function linkifyBareDomainsInMarkdown(markdown: string): string {
  if (!markdown) return markdown;

  const mdLinkRanges = collectMarkdownLinkRanges(markdown);
  let result = "";
  let i = 0;
  const len = markdown.length;

  while (i < len) {
    const insideLink = rangeContaining(mdLinkRanges, i);
    if (insideLink) {
      result += markdown.slice(i, insideLink.end);
      i = insideLink.end;
      continue;
    }

    const ch = markdown[i]!;

    if (isFenceChar(ch)) {
      let fenceLen = 0;
      let j = i;
      while (j < len && markdown[j] === ch) {
        fenceLen += 1;
        j += 1;
      }
      if (fenceLen >= 3) {
        const end = skipFencedCode(markdown, i, ch);
        result += markdown.slice(i, end);
        i = end;
        continue;
      }
      // Inline code is backtick-only; `~~` is GFM strikethrough, not a fence.
      if (ch === "`") {
        const end = skipInlineCode(markdown, i);
        result += markdown.slice(i, end);
        i = end;
        continue;
      }
    }

    if (ch === "<") {
      const close = markdown.indexOf(">", i + 1);
      if (close !== -1) {
        result += markdown.slice(i, close + 1);
        i = close + 1;
        continue;
      }
      result += ch;
      i += 1;
      continue;
    }

    if (
      markdown.startsWith("https://", i) ||
      markdown.startsWith("http://", i)
    ) {
      const end = skipSchemeUrl(markdown, i);
      result += markdown.slice(i, end);
      i = end;
      continue;
    }

    if (isAsciiLetter(ch) || isAsciiDigit(ch)) {
      const hit = tryMatchBareDomain(markdown, i);
      if (hit) {
        const href = `https://${hit.match}`;
        result += `[${escapeMarkdownLinkLabel(hit.match)}](${escapeMarkdownLinkUrl(href)})`;
        i = hit.end;
        continue;
      }
    }

    result += ch;
    i += 1;
  }

  return result;
}

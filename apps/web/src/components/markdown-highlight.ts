// Constants for performance and security
const MAX_QUERY_LENGTH = 256;
const REGEX_CACHE_SIZE = 50;

export interface HighlightOptions {
  term?: string | undefined;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// LRU cache for compiled regexes
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    // Remove if exists to update position
    this.cache.delete(key);

    // Check size limit
    if (this.cache.size >= this.maxSize) {
      // Remove least recently used (first item)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }
}

const regexCache = new LRUCache<string, RegExp>(REGEX_CACHE_SIZE);

function getCachedRegex(term: string): RegExp {
  let regex = regexCache.get(term);
  if (!regex) {
    const escaped = escapeRegex(term);
    regex = new RegExp(`(${escaped})`, "gi");
    regexCache.set(term, regex);
  }
  return regex;
}

export function applyMarkdownHighlighting(
  markdown: string,
  options: HighlightOptions,
) {
  const q = (options.term ?? "").trim();
  if (!q || q.length > MAX_QUERY_LENGTH) return markdown;

  try {
    const regex = getCachedRegex(q);

    const markOpen =
      '<mark class="bg-primary/50 text-foreground rounded-sm px-0.5">';
    const markClose = "</mark>";
    const markReplacement = `${markOpen}$1${markClose}`;

    function applyUnderlineToGroup(group: string) {
      return group
        .split("")
        .map((ch) => `${ch}\u0332`)
        .join("");
    }

    function applyUnderline(text: string) {
      return text.replace(regex, (_m, g1: string) => applyUnderlineToGroup(g1));
    }
    function applyMark(text: string) {
      return text.replace(regex, markReplacement);
    }

    const fencedParts = markdown.split(/(```[\s\S]*?```)/g);

    const processed = fencedParts
      .map((part) => {
        const isFenced = part.startsWith("```");
        if (isFenced) return applyUnderline(part);
        const inlineParts = part.split(/(`[^`\n]+`)/g);
        return inlineParts
          .map((seg) => {
            const isInline = seg.startsWith("`") && seg.endsWith("`");
            if (isInline) return applyUnderline(seg);
            return applyMark(seg);
          })
          .join("");
      })
      .join("");

    return processed;
  } catch {
    return markdown;
  }
}

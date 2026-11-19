// ponytail: word overlap with a length cut and a short English stop list.
// Reworded duplicates with no shared word still slip through; a search index
// on Core is the upgrade if title matches miss too much.
const STOP_WORDS = new Set([
  "about",
  "also",
  "from",
  "have",
  "into",
  "just",
  "need",
  "please",
  "than",
  "that",
  "their",
  "them",
  "then",
  "there",
  "this",
  "what",
  "when",
  "will",
  "with",
  "your",
]);

const MIN_WORD_LENGTH = 4;
const SEARCH_TERMS = 3;
// Core matches a substring of the name, so a stem finds "posts" and "post".
const STEM_LENGTH = 6;
export const SIMILAR_TASKS_LIMIT = 3;

function significantWords(text: string): string[] {
  const words = text
    .replace(/\S+:\/\/\S+/g, " ")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= MIN_WORD_LENGTH && !STOP_WORDS.has(word));
  return [...new Set(words)];
}

function sameWord(a: string, b: string): boolean {
  return a.startsWith(b) || b.startsWith(a);
}

/** The words to ask Core's Task name search for; none for a brief too short to match. */
export function similarTaskSearchTerms(brief: string): string[] {
  const words = significantWords(brief);
  if (words.length < 2) return [];
  return words
    .toSorted((a, b) => b.length - a.length)
    .slice(0, SEARCH_TERMS)
    .map((word) => word.slice(0, STEM_LENGTH));
}

/** Tasks whose name shares at least two words with the brief (one for a one-word name), most shared first. */
export function rankSimilarTasks<T extends { id: string; name: string }>(
  brief: string,
  tasks: readonly T[],
): T[] {
  const briefWords = significantWords(brief);
  const seen = new Set<string>();
  const scored: { task: T; shared: number }[] = [];

  for (const task of tasks) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    const nameWords = significantWords(task.name);
    const shared = nameWords.filter((word) =>
      briefWords.some((briefWord) => sameWord(word, briefWord)),
    ).length;
    if (shared > 0 && shared >= Math.min(2, nameWords.length)) {
      scored.push({ task, shared });
    }
  }

  return scored
    .toSorted((a, b) => b.shared - a.shared)
    .slice(0, SIMILAR_TASKS_LIMIT)
    .map(({ task }) => task);
}

/**
 * Texts of one month that say what an earlier one says, by meaning: a month
 * once repeated four messages across 45 posts, in other words each time, so
 * shared words missed it. A repeat is a quality problem, not a safety one,
 * so when the embedding model fails the check is skipped.
 */
import { createHash } from "node:crypto";
import { type EmbedTexts, embedTexts } from "@/lib/embeddings";

/**
 * Cosine similarity at which two texts say one thing, measured on real
 * months (`scripts/calibrate-repeats.mts`); an absolute cutoff, since a
 * brand short on facts has a high median and repeats the most.
 * Titles: in 11 brands' months same-brand pairs sit at a median of 0.47 to
 * 0.55; at 0.86 or above they are rewordings ("Make the first email
 * relevant" / "How to write a relevant first email", 0.935), below it
 * distinct pieces start ("See what the Email plan includes" / "Start an
 * Email plan trial", 0.851).
 * Posts: begin.is's 39-post month (median 0.69) recycled about ten claims;
 * at 0.88, 12 of its 15 refused saves still repeat a post (0.90 to 0.97)
 * and the two that shared only words pass (0.66, 0.70); below it the
 * same-topic posts with their own point start.
 */
export const REPEAT_CUTOFF = { title: 0.86, post: 0.88 } as const;

/** Embeddings by text hash, so a month's siblings are embedded once per process. */
const cache = new Map<string, number[]>();
const MAX_CACHED = 2_000;
/** Texts per embedding call. */
const BATCH = 50;
/**
 * How long a check waits on the model before it lets the text through; an
 * answer that comes later still fills the cache for the next check.
 */
const WAIT_MS = 8_000;

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

function cosine(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index++) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  return dot / Math.sqrt(leftNorm * rightNorm || 1);
}

async function embedAll(
  texts: readonly string[],
  embed: EmbedTexts,
): Promise<{ vectors: Map<string, number[]>; costUsd: number }> {
  const keys = texts.map(hash);
  const missing = [
    ...new Map(
      texts
        .map((text, index) => [keys[index] ?? "", text] as const)
        .filter(([key]) => !cache.has(key)),
    ),
  ];
  const results = await Promise.all(
    Array.from({ length: Math.ceil(missing.length / BATCH) }, (_, batch) => {
      const slice = missing.slice(batch * BATCH, (batch + 1) * BATCH);
      return embed(slice.map(([, text]) => text)).then((result) => ({
        slice,
        result,
      }));
    }),
  );
  let costUsd = 0;
  for (const { slice, result } of results) {
    costUsd += result.costUsd;
    slice.forEach(([key], index) => {
      const vector = result.embeddings[index];
      if (vector) cache.set(key, vector);
    });
  }
  while (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  const vectors = new Map<string, number[]>();
  for (const key of keys) {
    const vector = cache.get(key);
    if (vector) vectors.set(key, vector);
  }
  return { vectors, costUsd };
}

/**
 * For each text, the index of the earlier text it says again (the closest
 * one at or above the cutoff), or null. Blank texts are never repeats.
 */
export async function findRepeats(
  texts: readonly string[],
  kind: keyof typeof REPEAT_CUTOFF,
  embed: EmbedTexts = embedTexts,
): Promise<{ repeats: (number | null)[]; costUsd: number }> {
  const trimmed = texts.map((text) => text.trim());
  const none = { repeats: trimmed.map(() => null), costUsd: 0 };
  const filled = trimmed.filter(Boolean);
  if (filled.length < 2) return none;
  let embedded: Awaited<ReturnType<typeof embedAll>>;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const embedding = embedAll(filled, embed);
    embedding.catch(() => {});
    embedded = await Promise.race([
      embedding,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`no answer in ${WAIT_MS} ms`)),
          WAIT_MS,
        );
      }),
    ]);
  } catch (error) {
    console.warn("[repeats] embedding failed; check skipped", error);
    return none;
  } finally {
    clearTimeout(timer);
  }
  const vectorOf = (text: string) =>
    text ? embedded.vectors.get(hash(text)) : undefined;
  const repeats = trimmed.map((text, index) => {
    const own = vectorOf(text);
    if (!own) return null;
    let closest: { index: number; score: number } | null = null;
    for (let earlier = 0; earlier < index; earlier++) {
      const theirs = vectorOf(trimmed[earlier] ?? "");
      if (!theirs) continue;
      const score = cosine(own, theirs);
      if (score >= REPEAT_CUTOFF[kind] && score > (closest?.score ?? 0))
        closest = { index: earlier, score };
    }
    return closest?.index ?? null;
  });
  return { repeats, costUsd: embedded.costUsd };
}

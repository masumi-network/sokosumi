/**
 * Calibrates `REPEAT_CUTOFF` (src/lib/repeats.ts) on real embeddings: for
 * each month, the spread of same-month similarities and its closest pairs,
 * then the score of every labelled pair. Read the pairs around the cutoff
 * before moving it.
 *
 * AI_GATEWAY_API_KEY=… npx tsx scripts/calibrate-repeats.mts months.json
 *
 * months.json: [{ "name": "begin.is", "texts": ["…"], "repeats": [["…", "…"]],
 * "distinct": [["…", "…"]] }], one entry per month and kind (titles or post
 * texts, never mixed). Calls the embedding model; costs well under a cent.
 */
import { readFileSync } from "node:fs";
import { embedTexts } from "@/lib/embeddings";

interface Month {
  name: string;
  texts: string[];
  repeats?: [string, string][];
  distinct?: [string, string][];
}

const file = process.argv[2];
if (!file) throw new Error("Usage: calibrate-repeats.mts months.json");
const months = JSON.parse(readFileSync(file, "utf8")) as Month[];

function cosine(left: number[], right: number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  left.forEach((value, index) => {
    const other = right[index] ?? 0;
    dot += value * other;
    leftNorm += value * value;
    rightNorm += other * other;
  });
  return dot / Math.sqrt(leftNorm * rightNorm);
}

const at = (sorted: number[], share: number) =>
  (
    sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0
  ).toFixed(3);

let costUsd = 0;
for (const month of months) {
  const labelled = [...(month.repeats ?? []), ...(month.distinct ?? [])].flat();
  const texts = [...new Set([...month.texts, ...labelled])];
  const result = await embedTexts(texts);
  costUsd += result.costUsd;
  const vector = new Map(
    texts.map((text, index) => [text, result.embeddings[index] ?? []]),
  );
  const score = (left: string, right: string) =>
    cosine(vector.get(left) ?? [], vector.get(right) ?? []);
  const pairs = month.texts.flatMap((text, index) =>
    month.texts
      .slice(0, index)
      .map((other) => ({ text, other, score: score(text, other) })),
  );
  const sorted = pairs.map((pair) => pair.score).sort((a, b) => a - b);
  console.log(
    `\n${month.name}: ${month.texts.length} texts, median ${at(sorted, 0.5)}, p90 ${at(sorted, 0.9)}, p99 ${at(sorted, 0.99)}, max ${at(sorted, 1)}`,
  );
  for (const pair of pairs.sort((a, b) => b.score - a.score).slice(0, 10))
    console.log(`  ${pair.score.toFixed(3)}  ${pair.text}  ~  ${pair.other}`);
  for (const [label, list] of [
    ["repeat", month.repeats ?? []],
    ["distinct", month.distinct ?? []],
  ] as const)
    for (const [left, right] of list)
      console.log(
        `  ${label.padEnd(8)} ${score(left, right).toFixed(3)}  ${left}  ~  ${right}`,
      );
}
console.log(`\ncost $${costUsd.toFixed(6)}`);

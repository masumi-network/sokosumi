/** Offline only. No inference, database access, or environment loading.
 * pnpm --filter core exec tsx scripts/soko-bot-prepare-evaluation.mts CASES.json OUTPUT.json
 * CASES must be human-sanitized synthetic fixtures; no retained conversations.
 * Output uses exclusive creation so an existing candidate cannot be overwritten.
 */
import { readFile, writeFile } from "node:fs/promises";
import { getSokoBotVersion } from "@sokosumi/soko-bot";
import {
  createSokoBotCandidate,
  sokoBotEvaluationCasesSchema,
} from "../src/lib/soko-bot/evaluation-preparation";

const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw new Error("Provide sanitized cases and a new output path");
const bytes = await readFile(input);
if (bytes.length > 2_000_000) throw new Error("Evaluation input exceeds 2 MB");
const cases = sokoBotEvaluationCasesSchema.parse(
  JSON.parse(bytes.toString("utf8")),
);
const base = getSokoBotVersion("v16");
const candidates = [
  "google/gemini-3.6-flash",
  "google/gemini-3.8-flash",
  "anthropic/claude-sonnet-5",
].map((model) => createSokoBotCandidate(base, model));
await writeFile(
  output,
  JSON.stringify(
    {
      status: "OFFLINE_PREPARATION_ONLY",
      reviewRequired:
        "Independent Claude review and renewed capability, routing and pricing verification before paid execution",
      limits: {
        totalUsd: 10,
        requests: 100,
        inputTokensPerRequest: 8192,
        outputTokensPerRequest: 2048,
        sdkRetries: 0,
      },
      candidates,
      cases,
    },
    null,
    2,
  ),
  { flag: "wx", mode: 0o600 },
);
console.log(
  `Prepared ${candidates.length} immutable candidates and ${cases.length} sanitized cases; no inference performed.`,
);

import { parseSokoBotMemory, SOKO_BOT_MEMORY_LIMITS } from "@sokosumi/soko-bot";
import { z } from "zod";

const MAX_RECALL_QUESTION_LENGTH = 500;
const MAX_RECALL_TOPICS = 8;
const MAX_RECALL_ENTRIES = 3;
const MAX_MEMORY_MARKDOWN_LENGTH = SOKO_BOT_MEMORY_LIMITS.maxBytes;
const RECALL_QUESTION =
  /^what (?:did i tell you|did i ask you to remember|have i told you) about\s+(.+?)[?.!]*$/i;
const TOPIC_WORDS = new Set([
  "a",
  "an",
  "and",
  "the",
  "for",
  "about",
  "to",
  "of",
  "my",
  "our",
  "task",
  "tasks",
  "work",
  "writing",
  "rule",
  "rules",
  "preference",
  "preferences",
  "language",
]);
const recallSource = z.object({
  source: z.literal("CHAT"),
  route: z.literal("DIRECT_RESPONSE"),
  userMessage: z.string().max(MAX_RECALL_QUESTION_LENGTH),
  contextSnapshot: z.object({
    packet: z.object({
      trigger: z.object({
        source: z.literal("CHAT"),
        route: z.literal("DIRECT_RESPONSE"),
        askedBy: z.object({ kind: z.literal("OWNER") }),
      }),
      memory: z.object({
        markdown: z.string().max(MAX_MEMORY_MARKDOWN_LENGTH),
      }),
    }),
  }),
});

function words(text: string): string[] {
  return (
    text
      .toLowerCase()
      .replace(/['’]s\b/g, "")
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

/**
 * A rejected model narrative remains rejected. An explicit owner recall can
 * instead quote relevant facts from the exact memory snapshot it was given.
 * Quoting saved text never grants permission to carry out its instructions.
 */
export function memoryRecallResponse(source: unknown): string | null {
  const parsed = recallSource.safeParse(source);
  if (!parsed.success || /[\r\n]/.test(parsed.data.userMessage)) return null;
  const question = parsed.data.userMessage.trim().match(RECALL_QUESTION);
  if (!question) return null;
  const topics = [
    ...new Set(words(question[1]).filter((word) => !TOPIC_WORDS.has(word))),
  ];
  if (!topics.length || topics.length > MAX_RECALL_TOPICS) return null;
  const memory = parseSokoBotMemory(
    parsed.data.contextSnapshot.packet.memory.markdown,
    {
      secretHandling: "redact",
    },
  );
  const matches = [...memory.preferences, ...memory.decisions]
    .filter((entry) => {
      const present = new Set(words(entry));
      return topics.every((topic) => present.has(topic));
    })
    .slice(0, MAX_RECALL_ENTRIES);
  return matches.length
    ? `Saved memory:\n${matches.map((entry) => `> ${entry.replace(/[\r\n]+/g, " ")}`).join("\n>\n")}`
    : null;
}
